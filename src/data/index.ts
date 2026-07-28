import type { Bar, BarSeries, Timeframe } from '@/types/market';

import { BinanceAdapter } from './adapters/BinanceAdapter';
import { CsvAdapter } from './adapters/CsvAdapter';
import { KrakenAdapter } from './adapters/KrakenAdapter';
import { AdapterError, type BaseAdapter } from './adapters/BaseAdapter';
import { coverage, missingRanges, readBars, writeBars, type CacheKey } from './cache';
import { dropForming, normalizeBars } from './normalizer';
import { limiterFor } from './rateLimiter';

/**
 * Point d'entrée unique de la couche données.
 *
 * Personne n'appelle un adaptateur directement : ni un composant, ni le
 * moteur. Ce module orchestre l'ordre — cache d'abord, réseau ensuite,
 * normalisation toujours — et c'est ce qui garantit que le moteur reçoit
 * partout des séries aux mêmes invariants.
 */

export const csvAdapter = new CsvAdapter();

const ADAPTATEURS: Readonly<Record<string, BaseAdapter>> = {
  binance: new BinanceAdapter(),
  kraken: new KrakenAdapter(),
  csv: csvAdapter,
};

/**
 * Limites par fournisseur. Volontairement en deçà des seuils annoncés : se
 * faire bannir coûte bien plus qu'une requête économisée.
 */
const LIMITES: Readonly<Record<string, { maxCalls: number; windowMs: number }>> = {
  binance: { maxCalls: 20, windowMs: 60_000 },
  kraken: { maxCalls: 10, windowMs: 60_000 },
  csv: { maxCalls: 1_000, windowMs: 1_000 },
};

export function adapter(id: string): BaseAdapter | undefined {
  return ADAPTATEURS[id];
}

export function adapterIds(): readonly string[] {
  return Object.keys(ADAPTATEURS);
}

export interface LoadOptions {
  readonly adapterId: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly from: number;
  readonly to: number;
  /** Ignore le cache et force un appel réseau. */
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
  readonly now?: number;
}

/**
 * Charge une série, cache d'abord.
 *
 * En cas d'échec réseau alors que le cache détient quelque chose, on sert le
 * cache **en le signalant** (`source: 'stale-cache'`). Un graphique périmé mais
 * annoncé comme tel vaut mieux qu'un écran vide ; un graphique périmé présenté
 * comme frais serait un mensonge.
 */
export async function loadSeries(options: LoadOptions): Promise<BarSeries> {
  const implementation = ADAPTATEURS[options.adapterId];
  if (!implementation) {
    throw new AdapterError(options.adapterId, 'unsupported', 'Fournisseur inconnu.');
  }

  const cle: CacheKey = {
    adapter: options.adapterId,
    symbol: options.symbol,
    timeframe: options.timeframe,
  };

  const enCache = options.refresh ? [] : await readBars(cle, options.from, options.to);
  const aChercher = options.refresh
    ? [{ from: options.from, to: options.to }]
    : missingRanges(enCache, options.timeframe, options.from, options.to);

  if (aChercher.length === 0) {
    return serie(options, finaliser(enCache, options), 'cache');
  }

  const limiteur = limiterFor(options.adapterId, LIMITES[options.adapterId]);
  const recuperees: Bar[] = [];

  try {
    for (const plage of aChercher) {
      const page = await limiteur.run(
        () =>
          implementation.fetchBars({
            symbol: options.symbol,
            timeframe: options.timeframe,
            from: plage.from,
            to: plage.to,
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        (erreur) => erreur instanceof AdapterError && erreur.retryable,
      );
      recuperees.push(...page);
    }
  } catch (erreur) {
    // Le cache sauve l'affichage, mais il est étiqueté périmé.
    if (enCache.length > 0) return serie(options, finaliser(enCache, options), 'stale-cache');
    throw erreur;
  }

  if (recuperees.length > 0) await writeBars(cle, recuperees);

  const fusion = normalizeBars([...enCache, ...recuperees], options.timeframe).bars;
  return serie(options, finaliser(fusion, options), recuperees.length > 0 ? 'network' : 'cache');
}

/**
 * Dernier filtre avant le moteur.
 *
 * ═══ Barrière anti-look-ahead ═══
 * La bougie en formation est retirée ici, et non chez chaque appelant : un seul
 * point de passage, donc aucun chemin ne peut l'oublier.
 */
function finaliser(bars: readonly Bar[], options: LoadOptions): readonly Bar[] {
  const maintenant = options.now ?? Math.floor(Date.now() / 1000);
  return dropForming(bars, options.timeframe, maintenant).filter(
    (bar) => bar.time >= options.from && bar.time <= options.to,
  );
}

function serie(
  options: LoadOptions,
  bars: readonly Bar[],
  source: BarSeries['source'],
): BarSeries {
  return {
    symbol: options.symbol,
    timeframe: options.timeframe,
    bars,
    source,
    adapterId: options.adapterId,
    fetchedAt: options.now ?? Math.floor(Date.now() / 1000),
  };
}

export { coverage, AdapterError };
export type { BaseAdapter };
