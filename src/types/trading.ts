import type { Decimal } from '@/lib/decimal';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'trailing_stop';
export type OrderStatus = 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';

export interface Order {
  readonly id: string;
  readonly symbol: string;
  readonly side: Side;
  readonly type: OrderType;
  readonly quantity: Decimal;
  /** Requis pour limit et stop, ignoré au marché. */
  readonly limitPrice?: Decimal;
  readonly stopPrice?: Decimal;
  readonly trailOffset?: Decimal;
  /**
   * Instant de la DÉCISION, en secondes.
   *
   * Le remplissage n'est autorisé que sur une bougie strictement postérieure.
   * C'est la barrière anti-look-ahead côté exécution : sans elle, un ordre
   * décidé sur la clôture se remplirait à cette même clôture, ce qu'aucun
   * marché ne permet.
   */
  readonly decidedAt: number;
  readonly status: OrderStatus;
  readonly reason: string;
}

export interface Fill {
  readonly orderId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly quantity: Decimal;
  readonly price: Decimal;
  readonly fee: Decimal;
  readonly slippage: Decimal;
  readonly filledAt: number;
}

export interface Position {
  readonly id: string;
  readonly symbol: string;
  readonly side: Side;
  readonly quantity: Decimal;
  readonly entryPrice: Decimal;
  readonly stopLoss?: Decimal;
  readonly takeProfit?: Decimal;
  readonly openedAt: number;
  readonly feesPaid: Decimal;
}

export type ExitReason = 'stop' | 'target' | 'signal' | 'manual' | 'panic' | 'liquidation';

export interface Trade {
  readonly id: string;
  readonly symbol: string;
  readonly side: Side;
  readonly quantity: Decimal;
  readonly entryPrice: Decimal;
  readonly exitPrice: Decimal;
  readonly openedAt: number;
  readonly closedAt: number;
  /** Net de frais et de slippage. Un P&L brut ne veut rien dire. */
  readonly pnl: Decimal;
  readonly fees: Decimal;
  readonly exitReason: ExitReason;
}
