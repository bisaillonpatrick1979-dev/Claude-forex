import type { Bar, Timeframe } from '@/types/market';
import { TIMEFRAME_SECONDS } from '@/types/market';

import { AdapterError, type AdapterCapabilities, type BaseAdapter, type FetchRange } from './BaseAdapter';
import { normalizeBars } from '../normalizer';

/**
 * Binance — bougies publiques, aucune clé requise.
 *
 * C'est le fournisseur par défaut : gratuit, sans inscription, profond en
 * historique, et généreux en débit. Ses limites propres :
 *   - mille bougies par requête au maximum, donc pagination obligatoire ;
 *   - horodatages en MILLISECONDES, à convertir en secondes chez nous ;
 *   - la dernière bougie rendue est celle EN FORMATION, il faut l'écarter.
 */

const RACINE = 'https://api.binance.com/api/v3/klines';
const MAX_PAR_APPEL = 1000;

const INTERVALLES: Readonly<Record<Timeframe, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

/** Une kline Binance est un tableau positionnel, pas un objet. */
type Kline = readonly [number, string, string, string, string, string, ...unknown[]];

export class BinanceAdapter implements BaseAdapter {
  readonly id = 'binance';
  readonly name = 'Binance';

  capabilities(): AdapterCapabilities {
    return {
      realtime: false,
      historical: true,
      trading: false,
      requiresKey: false,
      maxBarsPerCall: MAX_PAR_APPEL,
      timeframes: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
    };
  }

  async fetchBars(range: FetchRange): Promise<readonly Bar[]> {
    const pas = TIMEFRAME_SECONDS[range.timeframe];
    const collectees: Bar[] = [];

    let curseur = range.from;
    // Garde-fou de boucle : sans lui, un fournisseur qui rend toujours la même
    // page ferait tourner la pagination indéfiniment.
    let pages = 0;
    const pagesMax = 200;

    while (curseur <= range.to && pages < pagesMax) {
      pages += 1;

      const url = new URL(RACINE);
      url.searchParams.set('symbol', range.symbol.toUpperCase());
      url.searchParams.set('interval', INTERVALLES[range.timeframe]);
      url.searchParams.set('startTime', String(curseur * 1000));
      url.searchParams.set('endTime', String(range.to * 1000));
      url.searchParams.set('limit', String(MAX_PAR_APPEL));

      const page = await this.appeler(url, range.signal);
      if (page.length === 0) break;

      collectees.push(...page);

      const derniere = page[page.length - 1];
      if (!derniere) break;

      const suivant = derniere.time + pas;
      // Aucune progression : on s'arrête plutôt que de boucler.
      if (suivant <= curseur) break;
      curseur = suivant;

      if (page.length < MAX_PAR_APPEL) break;
    }

    return normalizeBars(collectees, range.timeframe).bars;
  }

  private async appeler(url: URL, signal?: AbortSignal): Promise<readonly Bar[]> {
    let reponse: Response;
    try {
      reponse = await fetch(url, signal ? { signal } : {});
    } catch {
      throw new AdapterError(this.id, 'network', 'Binance injoignable.');
    }

    if (reponse.status === 429 || reponse.status === 418) {
      throw new AdapterError(this.id, 'rate-limit', 'Limite de débit Binance atteinte.');
    }
    if (reponse.status === 400) {
      throw new AdapterError(this.id, 'unknown-symbol', 'Symbole ou intervalle refusé par Binance.');
    }
    if (!reponse.ok) {
      throw new AdapterError(this.id, 'bad-response', `Binance : HTTP ${reponse.status}.`);
    }

    const donnees: unknown = await reponse.json().catch(() => null);
    if (!Array.isArray(donnees)) {
      throw new AdapterError(this.id, 'bad-response', 'Réponse Binance illisible.');
    }

    return (donnees as Kline[]).map(convertir).filter((bar): bar is Bar => bar !== null);
  }
}

/**
 * Une kline vers une bougie.
 *
 * Les prix arrivent en chaînes de caractères — c'est voulu chez Binance, pour
 * éviter la perte de précision du JSON. On les convertit ici, et une valeur
 * illisible fait écarter la bougie plutôt que produire un NaN.
 */
function convertir(kline: Kline): Bar | null {
  const [ouvertureMs, o, h, l, c, v] = kline;
  if (typeof ouvertureMs !== 'number') return null;

  const bar: Bar = {
    time: Math.floor(ouvertureMs / 1000),
    open: Number(o),
    high: Number(h),
    low: Number(l),
    close: Number(c),
    volume: Number(v),
  };

  return Number.isFinite(bar.open) ? bar : null;
}
