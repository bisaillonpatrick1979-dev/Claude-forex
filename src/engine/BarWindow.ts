import type { Bar, Timeframe } from '@/types/market';
import type { StrategyContext } from '@/types/strategy';

/**
 * Fenêtre glissante sur une série. C'est ici que vit la barrière anti-look-ahead.
 *
 * ═══ Barrière anti-look-ahead ═══
 *
 * La série complète est détenue en privé et n'est jamais exposée. Une stratégie
 * ne reçoit qu'un `StrategyContext`, qui ne sait rendre que des bougies d'index
 * inférieur ou égal au curseur. Il n'existe aucun accesseur vers la suite : pas
 * de `bars`, pas de `length`, pas d'index. Tricher demanderait de modifier ce
 * fichier, pas d'écrire une stratégie astucieuse.
 *
 * C'est une garantie structurelle, pas une convention. La différence compte :
 * une convention se contourne par distraction, une structure non.
 */
export class BarWindow {
  private readonly bars: readonly Bar[];
  private curseur = -1;

  constructor(
    readonly symbol: string,
    readonly timeframe: Timeframe,
    bars: readonly Bar[],
  ) {
    this.bars = bars;
  }

  /** Nombre de bougies déjà révélées. */
  get revealed(): number {
    return this.curseur + 1;
  }

  get total(): number {
    return this.bars.length;
  }

  /** Révèle la bougie suivante et la rend. `undefined` si la série est finie. */
  advance(): Bar | undefined {
    if (this.curseur + 1 >= this.bars.length) return undefined;
    this.curseur += 1;
    return this.bars[this.curseur];
  }

  /**
   * Vue restreinte remise aux modules.
   *
   * Construite à chaque bougie et jamais conservée : un contexte gardé d'une
   * itération à l'autre continuerait de pointer vers un curseur qui, lui,
   * avance — et rendrait donc des bougies futures au tour suivant.
   */
  context(now: number): StrategyContext {
    const bars = this.bars;
    const fin = this.curseur;

    return {
      symbol: this.symbol,
      timeframe: this.timeframe,
      now,
      history(n: number): readonly Bar[] {
        if (n <= 0 || fin < 0) return [];
        const debut = Math.max(0, fin - n + 1);
        // `fin + 1` et pas davantage : la borne haute est figée à la
        // construction du contexte, elle ne peut pas suivre le curseur.
        return bars.slice(debut, fin + 1);
      },
      last(): Bar | undefined {
        return fin < 0 ? undefined : bars[fin];
      },
    };
  }

  /**
   * La bougie qui suivra — réservée au moteur, jamais aux stratégies.
   *
   * L'exécution en a besoin pour remplir un ordre à l'ouverture suivante, ce
   * qui est le comportement correct : la décision est déjà prise et figée.
   * Aucun module ne reçoit cette méthode.
   */
  peekNext(): Bar | undefined {
    return this.bars[this.curseur + 1];
  }

  reset(): void {
    this.curseur = -1;
  }
}
