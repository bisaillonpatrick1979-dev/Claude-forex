import type { Instrument } from '@/lib/execution/types';
import { atr, clotures, derniereValeur, macd, moyenneMobileExponentielle, rsi } from '@/lib/marche/indicateurs';
import type { Chandelier, Intervalle, OrigineDonnees } from '@/lib/marche/types';

/**
 * Instantané de marché : la seule source de chiffres à laquelle les agents ont
 * droit.
 *
 * L'exigence « aucun agent ne cite un prix absent de son snapshot » n'est pas
 * tenable par la seule consigne. Elle repose sur trois choses :
 *   1. cet objet est figé et archivé dans `cycles.instantane_donnees`, donc le
 *      cycle est rejouable et vérifiable après coup ;
 *   2. il est rendu aux agents sous forme d'un tableau explicite, avec ses
 *      trous marqués « donnée manquante » plutôt que comblés ;
 *   3. les niveaux d'un ordre proposé sont recontrôlés contre les bornes de cet
 *      instantané avant d'atteindre le moteur (voir `extraction.ts`).
 */

export interface IndicateursInstantane {
  readonly rsi14: number | null;
  readonly atr14: number | null;
  readonly ema20: number | null;
  readonly ema50: number | null;
  readonly ema200: number | null;
  readonly macd: number | null;
  readonly macdSignal: number | null;
  readonly macdHistogramme: number | null;
}

export interface InstantaneMarche {
  readonly symbole: string;
  readonly classeActif: string;
  readonly intervalle: Intervalle;
  readonly decimales: number;
  readonly deviseCotation: string;
  /** Bougies retenues, de la plus ancienne à la plus récente. */
  readonly chandeliers: readonly Chandelier[];
  readonly dernierPrix: number;
  readonly plusHaut: number;
  readonly plusBas: number;
  readonly indicateurs: IndicateursInstantane;
  readonly origine: OrigineDonnees;
  readonly fournisseur: string;
  readonly perime: boolean;
  readonly retarde: boolean;
  readonly constitueLe: number;
  readonly nombreBougiesTotal: number;
}

/** Nombre de bougies détaillées dans le prompt. Au-delà, le contexte grossit
 *  sans que la qualité suive, et chaque token est facturé. */
const BOUGIES_DETAILLEES = 40;

export function construireInstantane(
  instrument: Instrument,
  intervalle: Intervalle,
  chandeliers: readonly Chandelier[],
  meta: { origine: OrigineDonnees; fournisseur: string; perime: boolean; retarde: boolean },
): InstantaneMarche | null {
  if (chandeliers.length === 0) return null;

  const prix = clotures(chandeliers);
  const resultatMacd = macd(prix);
  const derniere = chandeliers[chandeliers.length - 1]!;
  const retenues = chandeliers.slice(-BOUGIES_DETAILLEES);

  return {
    symbole: instrument.code,
    classeActif: instrument.classeActif,
    intervalle,
    decimales: instrument.decimales,
    deviseCotation: instrument.deviseCotation,
    chandeliers: retenues,
    dernierPrix: derniere.cloture,
    plusHaut: Math.max(...retenues.map((bougie) => bougie.haut)),
    plusBas: Math.min(...retenues.map((bougie) => bougie.bas)),
    indicateurs: {
      rsi14: derniereValeur(rsi(prix, 14)),
      atr14: derniereValeur(atr(chandeliers, 14)),
      ema20: derniereValeur(moyenneMobileExponentielle(prix, 20)),
      ema50: derniereValeur(moyenneMobileExponentielle(prix, 50)),
      ema200: derniereValeur(moyenneMobileExponentielle(prix, 200)),
      macd: derniereValeur(resultatMacd.macd),
      macdSignal: derniereValeur(resultatMacd.signal),
      macdHistogramme: derniereValeur(resultatMacd.histogramme),
    },
    origine: meta.origine,
    fournisseur: meta.fournisseur,
    perime: meta.perime,
    retarde: meta.retarde,
    constitueLe: Math.floor(Date.now() / 1000),
    nombreBougiesTotal: chandeliers.length,
  };
}

function nombre(valeur: number | null, decimales: number): string {
  // « donnée manquante » et non « 0 » : un indicateur en période de chauffe
  // n'est pas nul, il n'existe pas encore.
  return valeur === null ? 'donnée manquante' : valeur.toFixed(decimales);
}

function horodatageLisible(secondes: number): string {
  return new Date(secondes * 1000).toISOString().replace('.000Z', 'Z');
}

/** Rendu texte servi aux agents. Volontairement tabulaire : un modèle lit mal
 *  du JSON dense, et un tableau se relit à l'œil pendant un audit. */
export function rendreInstantane(instantane: InstantaneMarche): string {
  const d = instantane.decimales;

  const lignes = instantane.chandeliers.map(
    (bougie) =>
      `${horodatageLisible(bougie.horodatage)} | O ${bougie.ouverture.toFixed(d)} | H ${bougie.haut.toFixed(d)} | B ${bougie.bas.toFixed(d)} | C ${bougie.cloture.toFixed(d)} | V ${bougie.volume === null ? 'n/d' : bougie.volume}`,
  );

  const avertissements: string[] = [];
  if (instantane.perime) {
    avertissements.push(
      'ATTENTION : ces données sortent du cache et ont dépassé leur durée de validité.',
    );
  }
  if (instantane.retarde) {
    avertissements.push('ATTENTION : le fournisseur annonce des données retardées.');
  }

  return [
    `INSTANTANÉ DE MARCHÉ — ${instantane.symbole} (${instantane.classeActif}) en ${instantane.intervalle}`,
    `Source : ${instantane.fournisseur} (${instantane.origine}) — constitué le ${horodatageLisible(instantane.constitueLe)}`,
    ...avertissements,
    '',
    `Dernier prix : ${instantane.dernierPrix.toFixed(d)} ${instantane.deviseCotation}`,
    `Extrêmes des ${instantane.chandeliers.length} dernières bougies : bas ${instantane.plusBas.toFixed(d)} / haut ${instantane.plusHaut.toFixed(d)}`,
    '',
    'INDICATEURS',
    `RSI(14) : ${nombre(instantane.indicateurs.rsi14, 2)}`,
    `ATR(14) : ${nombre(instantane.indicateurs.atr14, d)}`,
    `EMA(20) : ${nombre(instantane.indicateurs.ema20, d)}`,
    `EMA(50) : ${nombre(instantane.indicateurs.ema50, d)}`,
    `EMA(200) : ${nombre(instantane.indicateurs.ema200, d)}`,
    `MACD : ${nombre(instantane.indicateurs.macd, d)} | signal ${nombre(instantane.indicateurs.macdSignal, d)} | histogramme ${nombre(instantane.indicateurs.macdHistogramme, d)}`,
    '',
    `CHANDELIERS (${instantane.chandeliers.length} sur ${instantane.nombreBougiesTotal} disponibles, du plus ancien au plus récent, horodatage UTC = ouverture)`,
    ...lignes,
  ].join('\n');
}

/**
 * Bornes acceptables pour un niveau proposé par un agent.
 *
 * On tolère une marge autour de l'amplitude observée : un stop ou une cible se
 * placent légitimement hors du range récent. Mais un niveau à 30 % du prix sur
 * un instantané qui bouge de 0,3 % n'est pas un choix de trading, c'est une
 * hallucination — et elle est refusée par le code.
 */
export function bornesPlausibles(instantane: InstantaneMarche): { min: number; max: number } {
  const amplitude = Math.max(
    instantane.plusHaut - instantane.plusBas,
    instantane.indicateurs.atr14 ?? 0,
    instantane.dernierPrix * 0.001,
  );
  const marge = amplitude * 5;
  return {
    min: Math.max(0, instantane.plusBas - marge),
    max: instantane.plusHaut + marge,
  };
}
