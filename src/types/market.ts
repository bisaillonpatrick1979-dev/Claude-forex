/** Unités de temps disponibles. Ordonnées du plus fin au plus large. */
export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Durée d'une unité, en secondes. Sert au moteur et au cache. */
export const TIMEFRAME_SECONDS: Readonly<Record<Timeframe, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '4h': 14_400,
  '1d': 86_400,
  '1w': 604_800,
};

/**
 * Une bougie close.
 *
 * `time` est en SECONDES UNIX, pas en millisecondes : c'est le format attendu
 * par lightweight-charts, et convertir à chaque rendu coûterait plus cher que
 * de normaliser une fois à l'entrée. Les adaptateurs qui rendent des
 * millisecondes convertissent chez eux.
 *
 * `time` marque l'OUVERTURE de la bougie. Une bougie présente dans le moteur
 * est une bougie close : celle en formation n'y entre jamais, sinon le moteur
 * lirait un prix qui n'est pas encore définitif.
 */
export interface Bar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type AssetClass = 'crypto' | 'stock' | 'forex' | 'index' | 'commodity';

export interface SymbolInfo {
  /** Identifiant interne, stable quel que soit le fournisseur. */
  readonly id: string;
  readonly label: string;
  readonly assetClass: AssetClass;
  /** Quotité minimale négociable. */
  readonly lotStep: string;
  /** Pas de cotation. */
  readonly priceStep: string;
  readonly quoteCurrency: string;
}

/** D'où viennent les bougies servies. Jamais caché à l'utilisateur. */
export type BarSource = 'network' | 'cache' | 'stale-cache' | 'file';

export interface BarSeries {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly bars: readonly Bar[];
  readonly source: BarSource;
  readonly adapterId: string;
  readonly fetchedAt: number;
}
