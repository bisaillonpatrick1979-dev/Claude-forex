import { ATR, EMA } from '../indicators';
import type { AlphaModule } from '../interfaces';
import type { Signal, StrategyContext } from '@/types/strategy';

export interface EmaCrossOptions {
  readonly fast: number;
  readonly slow: number;
  /** Période de l'ATR, utilisée pour placer stop et objectif. */
  readonly atr: number;
}

export const EMA_CROSS_DEFAULTS: EmaCrossOptions = { fast: 12, slow: 26, atr: 14 };

/**
 * Croisement de deux moyennes exponentielles.
 *
 * Stratégie de référence, pas de recommandation. Elle sert à vérifier que le
 * moteur produit des trades et à donner un point de comparaison : une stratégie
 * plus savante qui ne bat pas un croisement d'EMA après frais ne vaut pas la
 * complexité qu'elle coûte.
 *
 * Elle n'émet un signal qu'au moment du croisement, pas tant que l'écart
 * persiste : répéter le même avis à chaque bougie ferait ré-entrer en position
 * en payant les frais une fois de plus pour rien.
 */
export class EmaCrossAlpha implements AlphaModule {
  readonly id = 'ema-cross';

  private readonly rapide: EMA;
  private readonly lente: EMA;
  private readonly atr: ATR;
  /** Signe du dernier écart connu. `0` tant qu'on n'a pas de référence. */
  private signePrecedent = 0;
  private ecartPrecedent = 0;

  private readonly options: EmaCrossOptions;

  constructor(options: Partial<EmaCrossOptions> = {}) {
    this.options = { ...EMA_CROSS_DEFAULTS, ...options };
    if (this.options.fast >= this.options.slow) {
      throw new Error('EMA cross : la période rapide doit être plus courte que la lente');
    }
    this.rapide = new EMA(this.options.fast);
    this.lente = new EMA(this.options.slow);
    this.atr = new ATR(this.options.atr);
  }

  /** L'EMA lente s'amorce sur une SMA : il lui faut sa période complète. */
  warmup(): number {
    return Math.max(this.options.slow, this.options.atr) + 1;
  }

  onBar(ctx: StrategyContext): Signal | null {
    const bougie = ctx.last();
    if (!bougie) return null;

    this.rapide.update(bougie);
    this.lente.update(bougie);
    this.atr.update(bougie);

    if (!this.rapide.ready || !this.lente.ready) return null;

    const ecart = this.rapide.value - this.lente.value;
    const signe = Math.sign(ecart);
    const precedentSigne = this.signePrecedent;
    const precedentEcart = this.ecartPrecedent;
    this.signePrecedent = signe;
    this.ecartPrecedent = ecart;

    // Premier écart connu : on enregistre l'état sans conclure. Traiter la
    // première lecture comme un croisement ouvrirait une position sur la seule
    // base de l'endroit où la série commence.
    if (precedentSigne === 0 || signe === 0 || signe === precedentSigne) return null;

    // La confiance porte sur la VITESSE du croisement, pas sur l'écart.
    // Au moment précis où les deux moyennes se croisent, l'écart vaut zéro par
    // construction : en faire une mesure de conviction rendrait tout
    // croisement également insignifiant. La vitesse, elle, distingue une
    // moyenne qui traverse franchement d'une qui effleure et repart.
    const echelle = this.atr.ready && this.atr.value > 0 ? this.atr.value : bougie.close * 0.01;
    const vitesse = Math.abs(ecart - precedentEcart) / echelle;
    const confiance = Math.min(1, vitesse);

    return {
      symbol: ctx.symbol,
      direction: signe > 0 ? 'long' : 'short',
      confidence: Number(confiance.toFixed(4)),
      timestamp: ctx.now,
      reason:
        signe > 0
          ? `EMA${this.options.fast} croise au-dessus d'EMA${this.options.slow}`
          : `EMA${this.options.fast} croise sous EMA${this.options.slow}`,
      features: {
        emaFast: this.rapide.value,
        emaSlow: this.lente.value,
        crossSpeedAtr: vitesse,
        atr: this.atr.value,
        close: bougie.close,
      },
    };
  }

  reset(): void {
    this.rapide.reset();
    this.lente.reset();
    this.atr.reset();
    this.signePrecedent = 0;
    this.ecartPrecedent = 0;
  }
}
