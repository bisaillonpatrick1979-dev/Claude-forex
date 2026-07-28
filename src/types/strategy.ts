import type { Bar, Timeframe } from './market';

export type Direction = 'long' | 'short' | 'flat';

/**
 * Un signal produit par un module alpha.
 *
 * `reason` et `features` ne sont pas décoratifs : un signal qu'on ne peut pas
 * expliquer ne peut pas être audité après une perte, et l'interface a
 * l'interdiction d'en afficher un sans son explication.
 */
export interface Signal {
  readonly symbol: string;
  readonly direction: Direction;
  /** Degré de confiance, de 0 à 1. */
  readonly confidence: number;
  readonly timestamp: number;
  readonly reason: string;
  readonly features: Readonly<Record<string, number>>;
}

/**
 * Ce qu'un module voit du monde à l'instant d'une bougie.
 *
 * ═══ Barrière anti-look-ahead ═══
 *
 * `history(n)` rend les n dernières bougies CLOSES, la plus récente en
 * dernier. La bougie en cours de formation n'y figure jamais, et il n'existe
 * aucun moyen d'atteindre une bougie postérieure : le contexte ne détient pas
 * la série complète, seulement un curseur borné à l'index courant.
 *
 * C'est structurel et non contractuel — une stratégie ne peut pas tricher même
 * en le voulant.
 */
export interface StrategyContext {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Horloge simulée. Seule source de temps autorisée dans le moteur. */
  readonly now: number;
  history(n: number): readonly Bar[];
  /** Dernière bougie close, ou `undefined` au tout premier appel. */
  last(): Bar | undefined;
}
