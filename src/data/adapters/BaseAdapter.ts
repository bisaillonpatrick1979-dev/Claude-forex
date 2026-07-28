import type { Bar, Timeframe } from '@/types/market';

/**
 * Contrat commun à toutes les sources de bougies.
 *
 * Chaque fournisseur a ses excentricités — millisecondes ou secondes, colonnes
 * parallèles ou objets, code HTTP 200 sur une erreur métier. Rien de tout cela
 * ne doit franchir cette frontière : ce qui sort d'un adaptateur est déjà
 * normalisé, trié, et libre de doublons.
 */
export interface AdapterCapabilities {
  readonly realtime: boolean;
  readonly historical: boolean;
  /** Peut-on passer des ordres ? Faux partout jusqu'à la phase 7. */
  readonly trading: boolean;
  readonly requiresKey: boolean;
  /** Bougies rendues au maximum par requête. Détermine la pagination. */
  readonly maxBarsPerCall: number;
  readonly timeframes: readonly Timeframe[];
}

export interface FetchRange {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Bornes en SECONDES UNIX, incluses. */
  readonly from: number;
  readonly to: number;
  readonly signal?: AbortSignal;
}

export interface BaseAdapter {
  readonly id: string;
  readonly name: string;
  capabilities(): AdapterCapabilities;
  /** Bougies closes, triées par temps croissant, sans doublon. */
  fetchBars(range: FetchRange): Promise<readonly Bar[]>;
  subscribe?(symbol: string, timeframe: Timeframe, onBar: (bar: Bar) => void): () => void;
}

export type ErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'unknown-symbol'
  | 'network'
  | 'bad-response'
  | 'unsupported';

/**
 * Erreur normalisée.
 *
 * `kind` sert au routage : un `rate-limit` mérite une attente, un `auth` ne
 * sera jamais résolu par un réessai. Confondre les deux fait boucler une
 * application sur une clé invalide.
 */
export class AdapterError extends Error {
  readonly kind: ErrorKind;
  readonly adapterId: string;

  constructor(adapterId: string, kind: ErrorKind, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.kind = kind;
    this.adapterId = adapterId;
  }

  get retryable(): boolean {
    return this.kind === 'rate-limit' || this.kind === 'network';
  }
}
