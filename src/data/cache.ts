import Dexie, { type Table } from 'dexie';

import type { Bar, Timeframe } from '@/types/market';
import { TIMEFRAME_SECONDS } from '@/types/market';

/**
 * Cache local des bougies, sur IndexedDB.
 *
 * Une bougie close ne change jamais. La retélécharger est donc du gaspillage
 * pur — de quota chez le fournisseur, et de données mobiles chez
 * l'utilisateur. Le cache est consulté avant tout appel réseau, et on ne
 * demande au réseau que les segments réellement manquants.
 *
 * Clé primaire composée : `[adapter+symbol+timeframe+time]`. Elle rend
 * l'insertion idempotente — réimporter une plage déjà connue écrase à
 * l'identique au lieu de dupliquer.
 */

interface LigneBougie extends Bar {
  readonly adapter: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

class BaseHailQuant extends Dexie {
  declare bars: Table<LigneBougie, [string, string, string, number]>;

  constructor() {
    super('hailquant');
    this.version(1).stores({
      bars: '[adapter+symbol+timeframe+time]',
    });
  }
}

const base = new BaseHailQuant();

export interface CacheKey {
  readonly adapter: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

export async function readBars(
  key: CacheKey,
  from: number,
  to: number,
): Promise<readonly Bar[]> {
  const lignes = await base.bars
    .where('[adapter+symbol+timeframe+time]')
    .between(
      [key.adapter, key.symbol, key.timeframe, from],
      [key.adapter, key.symbol, key.timeframe, to],
      true,
      true,
    )
    .toArray();

  return lignes
    .map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
}

export async function writeBars(key: CacheKey, bars: readonly Bar[]): Promise<void> {
  if (bars.length === 0) return;
  await base.bars.bulkPut(bars.map((bar) => ({ ...bar, ...key })));
}

export async function clearSeries(key: CacheKey): Promise<void> {
  await base.bars
    .where('[adapter+symbol+timeframe+time]')
    .between(
      [key.adapter, key.symbol, key.timeframe, 0],
      [key.adapter, key.symbol, key.timeframe, Number.MAX_SAFE_INTEGER],
      true,
      true,
    )
    .delete();
}

export interface Coverage {
  readonly bars: number;
  readonly first: number | null;
  readonly last: number | null;
}

export async function coverage(key: CacheKey): Promise<Coverage> {
  const toutes = await readBars(key, 0, Number.MAX_SAFE_INTEGER);
  return {
    bars: toutes.length,
    first: toutes[0]?.time ?? null,
    last: toutes[toutes.length - 1]?.time ?? null,
  };
}

/**
 * Segments manquants dans une plage demandée.
 *
 * Ne rend que ce qu'il faut vraiment aller chercher. Sur une série d'un an
 * déjà en cache, redemander les cinq dernières bougies coûte une requête au
 * lieu de plusieurs centaines.
 *
 * Les trous internes ne sont pas comblés : un marché fermé n'a pas de bougie,
 * et redemander éternellement un week-end ferait boucler l'application sur du
 * vide. Seules les bornes manquantes sont réclamées.
 */
export function missingRanges(
  cached: readonly Bar[],
  timeframe: Timeframe,
  from: number,
  to: number,
): readonly { from: number; to: number }[] {
  const pas = TIMEFRAME_SECONDS[timeframe];
  if (cached.length === 0) return [{ from, to }];

  const premier = cached[0]?.time ?? from;
  const dernier = cached[cached.length - 1]?.time ?? to;

  const manquants: { from: number; to: number }[] = [];
  if (premier > from) manquants.push({ from, to: premier - pas });
  if (dernier < to) manquants.push({ from: dernier + pas, to });

  return manquants;
}
