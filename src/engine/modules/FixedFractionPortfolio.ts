import { Decimal, d } from '@/lib/decimal';
import { deriveLimits } from '@/lib/portfolioMath';
import type { Signal } from '@/types/strategy';
import type { PortfolioContext, PortfolioModule, TargetPosition } from '../interfaces';

export interface FixedFractionOptions {
  /** Quotité minimale négociable. Une taille non alignée est refusée par tout broker. */
  readonly lotStep: string;
  /** Multiple d'ATR pour le stop. Zéro désactive le stop automatique. */
  readonly stopAtrMultiple: number;
  /** Rapport objectif / risque. 2 veut dire viser deux fois le risque pris. */
  readonly rewardRatio: number;
}

export const FIXED_FRACTION_DEFAULTS: FixedFractionOptions = {
  lotStep: '0.00001',
  stopAtrMultiple: 2,
  rewardRatio: 2,
};

/**
 * Dimensionnement à fraction fixe de l'enveloppe.
 *
 * Les pourcentages portent sur le capital confié à l'IA, jamais sur le compte
 * entier : confier 10 000 sur 100 000 puis risquer « 2 % » veut dire 200, pas
 * 2 000. C'est la seule lecture qui corresponde à ce que l'utilisateur croit
 * autoriser quand il déplace le curseur.
 *
 * La taille descend systématiquement à la quotité inférieure. Arrondir au plus
 * proche dépasserait le plafond qu'on vient de calculer — un plafond qu'on peut
 * franchir en arrondissant n'est pas un plafond.
 */
export class FixedFractionPortfolio implements PortfolioModule {
  readonly id = 'fixed-fraction';

  private readonly options: FixedFractionOptions;

  constructor(options: Partial<FixedFractionOptions> = {}) {
    this.options = { ...FIXED_FRACTION_DEFAULTS, ...options };
  }

  target(signal: Signal, ctx: PortfolioContext): TargetPosition | null {
    if (signal.direction === 'flat') return null;
    if (ctx.price.estZero() || ctx.price.estNegatif()) return null;

    const limites = deriveLimits(ctx.config);

    // Fraction fixe : chaque trade engage le plafond entier, pas une part
    // modulée par la confiance. C'est le sens du nom, et c'est aussi ce qui
    // rend le module lisible — la taille dépend des réglages de l'utilisateur,
    // d'une seule chose, et pas d'un score que personne ne sait interpréter.
    // La confiance reste portée par le signal, pour l'affichage et pour un
    // module de dimensionnement qui voudra s'en servir.
    const notionnelVoulu = limites.maxTradeValue;

    // Le solde disponible reste une limite dure : on ne dépense pas ce qu'on
    // n'a pas, même si le plafond de risque l'autoriserait.
    const notionnel = Decimal.min(notionnelVoulu, Decimal.max(ctx.cash, Decimal.ZERO));
    if (notionnel.estZero()) return null;

    const pas = d(this.options.lotStep);
    const quantite = notionnel.divisePar(ctx.price, 'BAS').auPas(pas, 'BAS');
    if (quantite.estZero()) return null;

    // Notionnel recalculé à partir de la quantité réellement retenue :
    // l'arrondi à la quotité vient d'en retirer un morceau, et laisser le
    // montant voulu ferait mentir tous les contrôles de risque en aval.
    const notionnelReel = quantite.fois(ctx.price);
    const side = signal.direction === 'long' ? 'buy' : 'sell';
    const atr = Number(signal.features['atr'] ?? 0);

    return {
      symbol: signal.symbol,
      side,
      quantity: quantite,
      lotStep: pas,
      notional: notionnelReel,
      ...this.barrieres(ctx.price, side, atr),
      reason: signal.reason,
      signal,
    };
  }


  /**
   * Stop et objectif dérivés de l'ATR, pas d'un pourcentage fixe.
   *
   * Un stop à « 2 % » se fait toucher constamment sur un instrument agité et ne
   * sert jamais sur un instrument calme. L'ATR met la barrière à la distance que
   * l'instrument parcourt réellement.
   */
  private barrieres(
    prix: Decimal,
    side: 'buy' | 'sell',
    atr: number,
  ): { stopLoss?: Decimal; takeProfit?: Decimal } {
    if (this.options.stopAtrMultiple <= 0 || !Number.isFinite(atr) || atr <= 0) return {};

    const risque = d(atr).fois(d(this.options.stopAtrMultiple));
    const gain = risque.fois(d(this.options.rewardRatio));

    if (side === 'buy') {
      const stop = prix.moins(risque);
      // Un stop sous zéro n'est pas un stop : mieux vaut pas de stop du tout
      // qu'une barrière qui ne se déclenchera jamais.
      return stop.estNegatif() || stop.estZero()
        ? { takeProfit: prix.plus(gain) }
        : { stopLoss: stop, takeProfit: prix.plus(gain) };
    }

    const objectif = prix.moins(gain);
    return objectif.estNegatif() || objectif.estZero()
      ? { stopLoss: prix.plus(risque) }
      : { stopLoss: prix.plus(risque), takeProfit: objectif };
  }
}
