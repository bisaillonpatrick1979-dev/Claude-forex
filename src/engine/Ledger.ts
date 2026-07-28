import { Decimal, d } from '@/lib/decimal';
import type { Bar } from '@/types/market';
import type { ExitReason, Fill, Position, Trade } from '@/types/trading';

/** Une journée UTC, en secondes. Sert au découpage de la perte quotidienne. */
const JOUR = 86_400;

export interface Barriers {
  readonly stopLoss?: Decimal;
  readonly takeProfit?: Decimal;
}

export interface BarrierHit {
  readonly position: Position;
  readonly price: Decimal;
  readonly reason: ExitReason;
}

/**
 * Livre de comptes : positions, solde, trades clos.
 *
 * Tout est en `Decimal`. Un solde en flottant dérive de quelques centièmes sur
 * quelques milliers de trades, et ces centièmes finissent par décider si une
 * limite de perte est franchie ou non.
 *
 * Le solde ne contient que du réalisé. Le latent vit dans l'équité, jamais dans
 * le cash : compter un gain non encaissé comme de l'argent disponible
 * permettrait de le dépenser deux fois.
 */
export class Ledger {
  private liquide: Decimal;
  private readonly ouvertes = new Map<string, Position>();
  private readonly clos: Trade[] = [];
  private sommet: Decimal;
  private compteur = 0;
  /** Réalisé du jour courant. Négatif = perte. */
  private jourCourant = -1;
  private realiseDuJour = Decimal.ZERO;

  constructor(private readonly capitalInitial: Decimal) {
    this.liquide = capitalInitial;
    this.sommet = capitalInitial;
  }

  get cash(): Decimal {
    return this.liquide;
  }

  get peakEquity(): Decimal {
    return this.sommet;
  }

  positions(): readonly Position[] {
    return [...this.ouvertes.values()];
  }

  trades(): readonly Trade[] {
    return [...this.clos];
  }

  /** Perte réalisée depuis le début de la journée. Positive = perte. */
  dailyLoss(now: number): Decimal {
    if (Math.floor(now / JOUR) !== this.jourCourant) return Decimal.ZERO;
    return this.realiseDuJour.estNegatif() ? this.realiseDuJour.negatif() : Decimal.ZERO;
  }

  /**
   * Équité : liquide + valeur courante des positions ouvertes.
   *
   * La valeur d'une position, c'est le notionnel immobilisé à l'entrée plus son
   * latent. Compter le notionnel courant à la place mélangerait le capital
   * engagé et le gain, et doublerait la variation de prix.
   */
  equity(prix: ReadonlyMap<string, Decimal>): Decimal {
    let total = this.liquide;
    for (const position of this.ouvertes.values()) {
      const engage = position.entryPrice.fois(position.quantity);
      const courant = prix.get(position.symbol);
      total = total.plus(engage).plus(courant ? latent(position, courant) : Decimal.ZERO);
    }
    return total;
  }

  markPeak(equite: Decimal): void {
    this.sommet = Decimal.max(this.sommet, equite);
  }

  /**
   * Applique un remplissage.
   *
   * Un remplissage de sens opposé ferme la position existante ; l'excédent
   * éventuel en ouvre une nouvelle dans l'autre sens. Ignorer l'excédent
   * laisserait de l'argent engagé sans position en face.
   */
  applyFill(fill: Fill, barrieres: Barriers = {}): Trade | null {
    const existante = this.ouvertes.get(fill.symbol);

    if (!existante) {
      this.ouvrir(fill, fill.quantity, fill.fee, barrieres);
      return null;
    }

    if (existante.side === fill.side) {
      // Renforcement : prix d'entrée moyenné sur la quantité totale.
      const quantite = existante.quantity.plus(fill.quantity);
      const engage = existante.entryPrice
        .fois(existante.quantity)
        .plus(fill.price.fois(fill.quantity));
      this.liquide = this.liquide.moins(fill.price.fois(fill.quantity)).moins(fill.fee);
      this.ouvertes.set(fill.symbol, {
        ...existante,
        quantity: quantite,
        entryPrice: engage.divisePar(quantite, 'PROCHE'),
        feesPaid: existante.feesPaid.plus(fill.fee),
      });
      return null;
    }

    const fermee = Decimal.min(existante.quantity, fill.quantity);
    // Les frais du remplissage se répartissent au prorata entre la part qui
    // ferme et la part qui rouvre : imputer tout à la fermeture surchargerait
    // le trade clos d'un coût qui appartient à la position suivante.
    const partFermee = fermee.divisePar(fill.quantity, 'PROCHE');
    const fraisFermeture = fill.fee.fois(partFermee);
    const trade = this.fermer(existante, fermee, fill, fraisFermeture);

    const excedent = fill.quantity.moins(fermee);
    if (!excedent.estZero()) {
      this.ouvrir(fill, excedent, fill.fee.moins(fraisFermeture), barrieres);
    }
    return trade;
  }

  /**
   * Barrières touchées par une bougie.
   *
   * Quand le stop ET l'objectif tombent dans le range d'une même bougie, on
   * retient le STOP. Rien dans une bougie ne dit lequel a été touché en
   * premier ; choisir l'objectif serait choisir l'hypothèse qui flatte, et
   * répétée sur des milliers de bougies elle fabrique une performance qui
   * n'existe pas.
   */
  checkBarriers(symbol: string, bar: Bar): readonly BarrierHit[] {
    const touches: BarrierHit[] = [];
    const haut = d(bar.high);
    const bas = d(bar.low);

    for (const position of this.ouvertes.values()) {
      if (position.symbol !== symbol) continue;

      const stop = position.stopLoss;
      const objectif = position.takeProfit;
      const stopTouche =
        stop !== undefined &&
        (position.side === 'buy' ? bas.plusPetitQue(stop) || bas.egal(stop) : haut.plusGrandQue(stop) || haut.egal(stop));

      if (stopTouche && stop !== undefined) {
        touches.push({ position, price: stop, reason: 'stop' });
        continue;
      }

      const objectifTouche =
        objectif !== undefined &&
        (position.side === 'buy'
          ? haut.plusGrandQue(objectif) || haut.egal(objectif)
          : bas.plusPetitQue(objectif) || bas.egal(objectif));

      if (objectifTouche && objectif !== undefined) {
        touches.push({ position, price: objectif, reason: 'target' });
      }
    }
    return touches;
  }

  /** Ferme une position à un prix donné, hors marché (stop, panique, fin de test). */
  closeAt(position: Position, prix: Decimal, at: number, reason: ExitReason, feeBps: number): Trade {
    const frais = prix.fois(position.quantity).pointsDeBase(feeBps);
    return this.fermer(
      position,
      position.quantity,
      {
        orderId: `exit-${position.id}`,
        symbol: position.symbol,
        side: position.side === 'buy' ? 'sell' : 'buy',
        quantity: position.quantity,
        price: prix,
        fee: frais,
        slippage: Decimal.ZERO,
        filledAt: at,
      },
      frais,
      reason,
    );
  }

  reset(): void {
    this.liquide = this.capitalInitial;
    this.sommet = this.capitalInitial;
    this.ouvertes.clear();
    this.clos.length = 0;
    this.compteur = 0;
    this.jourCourant = -1;
    this.realiseDuJour = Decimal.ZERO;
  }

  private ouvrir(fill: Fill, quantite: Decimal, frais: Decimal, barrieres: Barriers): void {
    this.compteur += 1;
    this.liquide = this.liquide.moins(fill.price.fois(quantite)).moins(frais);
    this.ouvertes.set(fill.symbol, {
      id: `pos-${this.compteur}`,
      symbol: fill.symbol,
      side: fill.side,
      quantity: quantite,
      entryPrice: fill.price,
      openedAt: fill.filledAt,
      feesPaid: frais,
      ...(barrieres.stopLoss ? { stopLoss: barrieres.stopLoss } : {}),
      ...(barrieres.takeProfit ? { takeProfit: barrieres.takeProfit } : {}),
    });
  }

  private fermer(
    position: Position,
    quantite: Decimal,
    sortie: Fill,
    frais: Decimal,
    reason: ExitReason = 'signal',
  ): Trade {
    const brut =
      position.side === 'buy'
        ? sortie.price.moins(position.entryPrice).fois(quantite)
        : position.entryPrice.moins(sortie.price).fois(quantite);

    // Part des frais d'entrée imputable à la quantité fermée : fermer la
    // moitié d'une position ne doit pas lui coûter tous les frais d'ouverture.
    const partEntree = quantite.divisePar(position.quantity, 'PROCHE');
    const fraisEntree = position.feesPaid.fois(partEntree);
    const fraisTotal = fraisEntree.plus(frais);

    // On récupère le notionnel immobilisé, plus ou moins le résultat brut,
    // moins les frais de sortie. Les frais d'entrée sont déjà sortis du solde.
    this.liquide = this.liquide
      .plus(position.entryPrice.fois(quantite))
      .plus(brut)
      .moins(frais);

    const net = brut.moins(fraisTotal);
    this.noterRealise(sortie.filledAt, net);

    const restant = position.quantity.moins(quantite);
    if (restant.estZero()) {
      this.ouvertes.delete(position.symbol);
    } else {
      this.ouvertes.set(position.symbol, {
        ...position,
        quantity: restant,
        feesPaid: position.feesPaid.moins(fraisEntree),
      });
    }

    const trade: Trade = {
      id: `trd-${this.clos.length + 1}`,
      symbol: position.symbol,
      side: position.side,
      quantity: quantite,
      entryPrice: position.entryPrice,
      exitPrice: sortie.price,
      openedAt: position.openedAt,
      closedAt: sortie.filledAt,
      // Net de frais : un P&L brut ne dit pas si le trade valait la peine.
      pnl: net,
      fees: fraisTotal,
      exitReason: reason,
    };
    this.clos.push(trade);
    return trade;
  }

  private noterRealise(at: number, net: Decimal): void {
    const jour = Math.floor(at / JOUR);
    if (jour !== this.jourCourant) {
      this.jourCourant = jour;
      this.realiseDuJour = Decimal.ZERO;
    }
    this.realiseDuJour = this.realiseDuJour.plus(net);
  }
}

function latent(position: Position, courant: Decimal): Decimal {
  return position.side === 'buy'
    ? courant.moins(position.entryPrice).fois(position.quantity)
    : position.entryPrice.moins(courant).fois(position.quantity);
}
