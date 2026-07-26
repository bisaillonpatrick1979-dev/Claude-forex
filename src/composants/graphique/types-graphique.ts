import type { SeriesMarkerBarPosition, SeriesMarkerShape } from 'lightweight-charts';

/** Indicateurs superposables au graphique. */
export interface IndicateursActifs {
  readonly sma20: boolean;
  readonly sma50: boolean;
  readonly ema20: boolean;
  readonly rsi: boolean;
}

export const INDICATEURS_DEFAUT: IndicateursActifs = {
  sma20: true,
  sma50: false,
  ema20: false,
  rsi: false,
};

/**
 * Marqueur posé sur le graphique à l'horodatage exact d'une décision.
 *
 * `raisonnement` est l'extrait affiché au survol — c'est le lien entre le
 * graphique et le fil des spécialistes. Alimenté à partir de la phase 5 ;
 * le graphique sait déjà les afficher.
 *
 * Position volontairement limitée aux ancrages sur bougie : un stop ou une
 * cible se représente par une ligne de prix, pas par un marqueur ancré à un
 * prix, qui se perdrait dès qu'on dézoome.
 */
export interface MarqueurDecision {
  readonly id: string;
  readonly horodatage: number;
  readonly position: SeriesMarkerBarPosition;
  readonly forme: SeriesMarkerShape;
  readonly couleur: string;
  readonly etiquette: string;
  readonly raisonnement: string;
}
