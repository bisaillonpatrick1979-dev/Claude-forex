import type { Decimal } from '@/lib/decimal';
import type { Bar, Timeframe } from '@/types/market';
import type { PortfolioConfig } from '@/types/portfolio';
import type { Signal, StrategyContext } from '@/types/strategy';
import type { Fill, Order, Position, Side, Trade } from '@/types/trading';

/**
 * Les cinq étages du moteur, déclarés avant d'être implémentés.
 *
 * Le découpage suit celui de LEAN : Univers → Alpha → Portefeuille → Risque →
 * Exécution. Chaque étage ne connaît que sa propre question, et rien de ce que
 * fait le suivant.
 *
 * L'intérêt n'est pas esthétique. Un alpha qui saurait combien de capital reste
 * commencerait à doser ses convictions selon le solde ; un module de risque qui
 * saurait passer des ordres finirait par en passer. Séparer, c'est empêcher.
 *
 * Ces interfaces sont volontairement synchrones. Un étage `async` autoriserait
 * deux bougies à se croiser dans le moteur, et l'ordre des événements est la
 * seule chose qui garantit qu'aucune décision ne lit son propre résultat.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Univers — quels instruments méritent d'être regardés
// ─────────────────────────────────────────────────────────────────────────────

export interface UniverseContext {
  readonly now: number;
  readonly candidates: readonly string[];
}

export interface UniverseModule {
  readonly id: string;
  select(ctx: UniverseContext): readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Alpha — que dit le marché
// ─────────────────────────────────────────────────────────────────────────────

export interface AlphaModule {
  readonly id: string;
  /**
   * Nombre de bougies closes requises avant que ce module ait le droit de
   * parler. En deçà, ses indicateurs ne sont pas encore établis et son avis
   * ne vaut rien — le moteur ne l'interroge même pas.
   */
  warmup(): number;
  /** `null` veut dire « rien à signaler », pas « erreur ». */
  onBar(ctx: StrategyContext): Signal | null;
  /** Remet les indicateurs à zéro entre deux passages de backtest. */
  reset(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Portefeuille — combien, si on y va
// ─────────────────────────────────────────────────────────────────────────────

/** Ce que le portefeuille voit. En lecture seule : il propose, il n'écrit pas. */
export interface PortfolioContext {
  readonly now: number;
  readonly config: PortfolioConfig;
  /** Enveloppe confiée à l'IA, pas le capital total du compte. */
  readonly aiCapital: Decimal;
  readonly cash: Decimal;
  readonly equity: Decimal;
  readonly price: Decimal;
  readonly positions: readonly Position[];
}

/** Une intention de position. Pas encore un ordre : le risque peut la refuser. */
export interface TargetPosition {
  readonly symbol: string;
  readonly side: Side;
  /** En unités de l'instrument, déjà alignée sur la quotité. */
  readonly quantity: Decimal;
  /**
   * Quotité minimale négociable, transportée avec l'intention.
   *
   * Le module de risque a besoin de réduire une taille sans connaître
   * l'instrument. La lui faire deviner à partir des décimales de la quantité
   * produirait une quotité fausse dès qu'une taille tombe sur un chiffre rond.
   */
  readonly lotStep: Decimal;
  /** Valeur notionnelle au prix courant, pour les contrôles de risque. */
  readonly notional: Decimal;
  readonly stopLoss?: Decimal;
  readonly takeProfit?: Decimal;
  readonly reason: string;
  readonly signal: Signal;
}

export interface PortfolioModule {
  readonly id: string;
  target(signal: Signal, ctx: PortfolioContext): TargetPosition | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Risque — a-t-on le droit
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskContext extends PortfolioContext {
  readonly peakEquity: Decimal;
  /** Perte réalisée depuis le début de la journée courante. Positive = perte. */
  readonly dailyLoss: Decimal;
  /** Horodatages des ordres soumis dans la dernière heure. */
  readonly recentOrderTimes: readonly number[];
}

/**
 * Un refus porte toujours un motif lisible.
 *
 * « Ordre refusé » sans explication conduit l'utilisateur à désactiver le
 * contrôle qui l'a protégé, faute de comprendre ce qu'il faisait.
 */
export type RiskDecision =
  | { readonly kind: 'approve'; readonly target: TargetPosition }
  | { readonly kind: 'reduce'; readonly target: TargetPosition; readonly reason: string }
  | { readonly kind: 'reject'; readonly reason: string };

export interface RiskModule {
  readonly id: string;
  vet(target: TargetPosition, ctx: RiskContext): RiskDecision;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Exécution — comment on y va
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionContext {
  readonly now: number;
  readonly config: PortfolioConfig;
  readonly timeframe: Timeframe;
}

export interface ExecutionModule {
  readonly id: string;
  /**
   * Enregistre l'ordre. Ne le remplit jamais tout de suite : une décision prise
   * sur une clôture ne peut pas s'exécuter à cette clôture.
   */
  submit(target: TargetPosition, ctx: ExecutionContext): Order;
  /**
   * Confronte les ordres en attente à une bougie.
   *
   * ═══ Barrière anti-look-ahead ═══ Seule une bougie postérieure à la décision
   * peut remplir un ordre. C'est vérifié ici, à l'endroit unique où un
   * remplissage peut naître.
   */
  onBar(bar: Bar, ctx: ExecutionContext): readonly Fill[];
  pending(): readonly Order[];
  cancelAll(reason: string): void;
  reset(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Événements du moteur
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineEvents {
  readonly bar: { readonly symbol: string; readonly bar: Bar };
  readonly signal: Signal;
  readonly order: Order;
  readonly fill: Fill;
  readonly trade: Trade;
  readonly rejected: { readonly reason: string; readonly at: number };
  readonly halt: { readonly reason: string; readonly at: number };
}
