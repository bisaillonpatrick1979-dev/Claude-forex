import type { Bar, Timeframe } from '@/types/market';

import { AdapterError, type AdapterCapabilities, type BaseAdapter, type FetchRange } from './BaseAdapter';
import { normalizeBars } from '../normalizer';

/**
 * Import d'un fichier local, CSV ou JSON.
 *
 * Sert à deux choses : rejouer une archive complète — Kraken publie plusieurs
 * gigaoctets gratuitement — et travailler hors ligne, ce qui compte quand on
 * développe sur tablette en déplacement.
 *
 * La détection des colonnes est automatique, mais **jamais devinée en
 * silence** : si un en-tête manque, l'import échoue avec la liste de ce qui a
 * été trouvé. Un fichier mal interprété produirait une série plausible et
 * fausse, ce qui est le pire des deux mondes.
 */

/** Noms acceptés par colonne, en minuscules. Anglais et français. */
const ALIAS: Readonly<Record<keyof Bar, readonly string[]>> = {
  time: ['time', 'timestamp', 'date', 'datetime', 'temps', 'horodatage', 'open_time'],
  open: ['open', 'o', 'ouverture'],
  high: ['high', 'h', 'haut', 'max'],
  low: ['low', 'l', 'bas', 'min'],
  close: ['close', 'c', 'cloture', 'clôture', 'dernier'],
  volume: ['volume', 'vol', 'v', 'qty', 'quantity'],
};

export interface CsvImport {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly bars: readonly Bar[];
  readonly droppedRows: number;
}

export class CsvAdapter implements BaseAdapter {
  readonly id = 'csv';
  readonly name = 'Fichier local';

  private readonly series = new Map<string, readonly Bar[]>();

  capabilities(): AdapterCapabilities {
    return {
      realtime: false,
      historical: true,
      trading: false,
      requiresKey: false,
      maxBarsPerCall: Number.MAX_SAFE_INTEGER,
      timeframes: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
    };
  }

  /** Charge un contenu déjà lu, et rend le rapport d'import. */
  load(symbol: string, timeframe: Timeframe, contenu: string): CsvImport {
    const brut = contenu.trimStart().startsWith('[')
      ? lireJson(contenu)
      : lireCsv(contenu);

    const { bars } = normalizeBars(brut.bars, timeframe, false);
    this.series.set(cle(symbol, timeframe), bars);

    return { symbol, timeframe, bars, droppedRows: brut.dropped + (brut.bars.length - bars.length) };
  }

  async fetchBars(range: FetchRange): Promise<readonly Bar[]> {
    const serie = this.series.get(cle(range.symbol, range.timeframe));
    if (!serie) {
      throw new AdapterError(this.id, 'unknown-symbol', `Aucun fichier chargé pour ${range.symbol}.`);
    }
    return serie.filter((bar) => bar.time >= range.from && bar.time <= range.to);
  }

  loadedSeries(): readonly string[] {
    return [...this.series.keys()];
  }
}

const cle = (symbol: string, timeframe: Timeframe): string => `${symbol}:${timeframe}`;

interface Lecture {
  readonly bars: readonly Bar[];
  readonly dropped: number;
}

function lireJson(contenu: string): Lecture {
  let donnees: unknown;
  try {
    donnees = JSON.parse(contenu);
  } catch {
    throw new AdapterError('csv', 'bad-response', 'JSON illisible.');
  }
  if (!Array.isArray(donnees)) {
    throw new AdapterError('csv', 'bad-response', 'Le JSON doit être un tableau de bougies.');
  }

  let dropped = 0;
  const bars: Bar[] = [];

  for (const ligne of donnees) {
    const bar = depuisObjet(ligne as Record<string, unknown>);
    if (bar) bars.push(bar);
    else dropped += 1;
  }

  return { bars, dropped };
}

function lireCsv(contenu: string): Lecture {
  const lignes = contenu.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const entete = lignes.shift();
  if (!entete) throw new AdapterError('csv', 'bad-response', 'Fichier vide.');

  const separateur = detecterSeparateur(entete);
  const colonnes = entete.split(separateur).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''));

  const index = {} as Record<keyof Bar, number>;
  for (const champ of Object.keys(ALIAS) as (keyof Bar)[]) {
    const position = colonnes.findIndex((nom) => ALIAS[champ].includes(nom));
    if (position === -1) {
      throw new AdapterError(
        'csv',
        'bad-response',
        `Colonne « ${champ} » introuvable. Colonnes lues : ${colonnes.join(', ')}.`,
      );
    }
    index[champ] = position;
  }

  let dropped = 0;
  const bars: Bar[] = [];

  for (const ligne of lignes) {
    const cellules = ligne.split(separateur);
    const bar = depuisObjet({
      time: cellules[index.time],
      open: cellules[index.open],
      high: cellules[index.high],
      low: cellules[index.low],
      close: cellules[index.close],
      volume: cellules[index.volume],
    });
    if (bar) bars.push(bar);
    else dropped += 1;
  }

  return { bars, dropped };
}

function detecterSeparateur(entete: string): string {
  const candidats = [',', ';', '\t', '|'];
  let meilleur = ',';
  let maximum = 0;
  for (const candidat of candidats) {
    const compte = entete.split(candidat).length;
    if (compte > maximum) {
      maximum = compte;
      meilleur = candidat;
    }
  }
  return meilleur;
}

function depuisObjet(source: Record<string, unknown>): Bar | null {
  const trouver = (champ: keyof Bar): unknown => {
    if (champ in source) return source[champ];
    for (const alias of ALIAS[champ]) {
      if (alias in source) return source[alias];
    }
    return undefined;
  };

  const temps = lireTemps(trouver('time'));
  if (temps === null) return null;

  const bar: Bar = {
    time: temps,
    open: Number(trouver('open')),
    high: Number(trouver('high')),
    low: Number(trouver('low')),
    close: Number(trouver('close')),
    volume: Number(trouver('volume') ?? 0),
  };

  return Number.isFinite(bar.open) && Number.isFinite(bar.close) ? bar : null;
}

/**
 * Horodatage tolérant : secondes, millisecondes, ou date ISO.
 *
 * Le seuil de discrimination est 10^11 — au-delà, c'est nécessairement des
 * millisecondes, puisque 10^11 secondes place la date en l'an 5138.
 */
function lireTemps(valeur: unknown): number | null {
  if (typeof valeur === 'number' || (typeof valeur === 'string' && /^\d+$/.test(valeur.trim()))) {
    const nombre = Number(valeur);
    if (!Number.isFinite(nombre) || nombre <= 0) return null;
    return nombre > 1e11 ? Math.floor(nombre / 1000) : Math.floor(nombre);
  }

  if (typeof valeur === 'string') {
    const analyse = Date.parse(valeur.trim().replace(/^"|"$/g, ''));
    if (!Number.isNaN(analyse)) return Math.floor(analyse / 1000);
  }

  return null;
}
