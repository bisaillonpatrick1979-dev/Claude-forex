import type { Bar, Timeframe } from '@/types/market';

import { AdapterError, type AdapterCapabilities, type BaseAdapter, type FetchRange } from './BaseAdapter';
import { normalizeBars } from '../normalizer';

/**
 * Kraken — bougies publiques, sans clé.
 *
 * Complète Binance : couvertures et paires différentes, et une seconde source
 * permet de repérer une anomalie sur la première. Ses particularités :
 *   - le paramètre `interval` est en MINUTES, pas en libellé ;
 *   - la charge utile est un objet dont la clé de résultat porte le nom
 *     canonique de la paire, qui n'est pas toujours celui qu'on a demandé
 *     (« BTCUSD » ressort en « XXBTZUSD ») — on prend donc la première clé
 *     autre que `last` plutôt que de deviner ;
 *   - les erreurs arrivent dans un tableau `error`, avec un HTTP 200.
 */

const RACINE = 'https://api.kraken.com/0/public/OHLC';

const MINUTES: Readonly<Record<Timeframe, number>> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

interface ReponseKraken {
  readonly error?: readonly string[];
  readonly result?: Record<string, unknown>;
}

export class KrakenAdapter implements BaseAdapter {
  readonly id = 'kraken';
  readonly name = 'Kraken';

  capabilities(): AdapterCapabilities {
    return {
      realtime: false,
      historical: true,
      trading: false,
      requiresKey: false,
      // Kraken plafonne à 720 bougies et ignore la borne haute : on ne pagine
      // pas, on prend ce qu'il donne depuis `since`.
      maxBarsPerCall: 720,
      timeframes: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
    };
  }

  async fetchBars(range: FetchRange): Promise<readonly Bar[]> {
    const url = new URL(RACINE);
    url.searchParams.set('pair', range.symbol.toUpperCase());
    url.searchParams.set('interval', String(MINUTES[range.timeframe]));
    url.searchParams.set('since', String(range.from));

    let reponse: Response;
    try {
      reponse = await fetch(url, range.signal ? { signal: range.signal } : {});
    } catch {
      throw new AdapterError(this.id, 'network', 'Kraken injoignable.');
    }

    if (reponse.status === 429) {
      throw new AdapterError(this.id, 'rate-limit', 'Limite de débit Kraken atteinte.');
    }
    if (!reponse.ok) {
      throw new AdapterError(this.id, 'bad-response', `Kraken : HTTP ${reponse.status}.`);
    }

    const donnees = (await reponse.json().catch(() => null)) as ReponseKraken | null;
    if (!donnees) throw new AdapterError(this.id, 'bad-response', 'Réponse Kraken illisible.');

    // Un HTTP 200 peut porter une erreur métier : le code seul ne conclut rien.
    if (donnees.error && donnees.error.length > 0) {
      const premier = donnees.error[0] ?? '';
      const genre = premier.includes('Unknown asset pair') ? 'unknown-symbol' : 'bad-response';
      throw new AdapterError(this.id, genre, `Kraken : ${premier}`);
    }

    const brut = extraireSerie(donnees.result);
    if (!brut) throw new AdapterError(this.id, 'unknown-symbol', 'Aucune série dans la réponse Kraken.');

    const bougies = brut
      .map(convertir)
      .filter((bar): bar is Bar => bar !== null)
      .filter((bar) => bar.time <= range.to);

    return normalizeBars(bougies, range.timeframe).bars;
  }
}

/** La clé de résultat porte le nom canonique de la paire, pas celui demandé. */
function extraireSerie(resultat: Record<string, unknown> | undefined): unknown[] | null {
  if (!resultat) return null;
  for (const [cle, valeur] of Object.entries(resultat)) {
    if (cle !== 'last' && Array.isArray(valeur)) return valeur;
  }
  return null;
}

/** [temps, ouverture, haut, bas, clôture, vwap, volume, nombre de trades] */
function convertir(ligne: unknown): Bar | null {
  if (!Array.isArray(ligne) || ligne.length < 7) return null;

  const bar: Bar = {
    time: Number(ligne[0]),
    open: Number(ligne[1]),
    high: Number(ligne[2]),
    low: Number(ligne[3]),
    close: Number(ligne[4]),
    // Index 5 est le VWAP, pas le volume : le confondre fausserait tout
    // indicateur pondéré par les volumes.
    volume: Number(ligne[6]),
  };

  return Number.isFinite(bar.time) && Number.isFinite(bar.open) ? bar : null;
}
