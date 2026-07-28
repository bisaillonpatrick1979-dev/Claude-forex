import type { Decimal } from '@/lib/decimal';

export type Currency = 'CAD' | 'USD';

/**
 * Réglages du portefeuille, tous modifiables par l'utilisateur.
 *
 * Les pourcentages sont exprimés en points (3 = 3 %), pas en fraction : c'est
 * ce que l'utilisateur tape dans l'interface, et convertir dans les deux sens
 * multiplierait les occasions de se tromper d'un facteur cent.
 */
export interface PortfolioConfig {
  readonly totalCapital: string;
  /** Part du capital confiée à l'IA, en pourcentage. */
  readonly aiAllocationPct: number;
  readonly maxTradeAmount: string;
  readonly maxTradePct: number;
  readonly maxOpenPositions: number;
  readonly maxDailyLossPct: number;
  readonly maxDrawdownPct: number;
  readonly maxTradesPerHour: number;
  /** Frais en points de base. 10 = 0,10 %. Jamais zéro par défaut. */
  readonly feeBps: number;
  readonly slippageBps: number;
  readonly currency: Currency;
}

export interface PortfolioState {
  /** Réalisé uniquement : le latent n'entre jamais dans le solde. */
  readonly cash: Decimal;
  readonly equity: Decimal;
  readonly peakEquity: Decimal;
  readonly openPositions: number;
  readonly aiArmed: boolean;
  readonly killSwitchArmed: boolean;
  readonly haltReason: string | null;
}
