import type { Order, Fill } from './trading';

export type BrokerMode = 'paper' | 'live';

/**
 * Contrat commun au simulateur et à un futur courtier réel.
 *
 * L'existence de cette interface est ce qui permettra de brancher un vrai
 * courtier sans réécrire le moteur : le moteur ne connaît que ce contrat.
 *
 * `mode: 'live'` reste un stub qui lève une exception jusqu'à la phase 7. Ce
 * n'est pas une précaution symbolique — tant que l'implémentation lève, aucun
 * chemin de code ne peut atteindre un ordre réel, même par erreur de câblage.
 */
export interface BrokerAdapter {
  readonly id: string;
  readonly name: string;
  readonly mode: BrokerMode;
  submit(order: Order): Promise<Fill | null>;
  cancel(orderId: string): Promise<boolean>;
  /** Ferme tout, au marché. Utilisé par le bouton PANIC. */
  closeAll(reason: string): Promise<readonly Fill[]>;
}

export class LiveTradingLockedError extends Error {
  constructor() {
    super(
      'Le mode LIVE est verrouillé. HailQuant ne transmet aucun ordre réel : ' +
        'ce chemin restera inaccessible jusqu’à la phase 7.',
    );
    this.name = 'LiveTradingLockedError';
  }
}
