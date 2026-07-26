import type { Chandelier } from './types';

/**
 * Indicateurs techniques — fonctions pures, testées.
 *
 * Deux règles communes à tous :
 *   1. la sortie a **exactement** la même longueur que l'entrée ;
 *   2. les positions où l'indicateur n'est pas encore défini valent `null`,
 *      jamais 0 ni la première valeur disponible. Un RSI qui vaudrait 0 sur ses
 *      treize premières bougies serait lu comme une survente extrême.
 *
 * Elles servent au graphique (phase 2) et au snapshot passé à l'analyste
 * technique (phase 4) : une seule implémentation, donc l'agent voit exactement
 * ce que je vois à l'écran.
 */

export type Serie = readonly (number | null)[];

export function moyenneMobileSimple(valeurs: readonly number[], periode: number): Serie {
  if (periode < 1) throw new Error('La période doit être positive.');
  const sortie: (number | null)[] = new Array(valeurs.length).fill(null);
  let somme = 0;

  for (let i = 0; i < valeurs.length; i += 1) {
    somme += valeurs[i]!;
    if (i >= periode) somme -= valeurs[i - periode]!;
    if (i >= periode - 1) sortie[i] = somme / periode;
  }

  return sortie;
}

/**
 * EMA amorcée par une moyenne simple sur la première fenêtre — c'est la
 * convention des plateformes de trading. Amorcer sur la première valeur seule
 * donnerait une courbe différente des graphiques de référence.
 */
export function moyenneMobileExponentielle(valeurs: readonly number[], periode: number): Serie {
  if (periode < 1) throw new Error('La période doit être positive.');
  const sortie: (number | null)[] = new Array(valeurs.length).fill(null);
  if (valeurs.length < periode) return sortie;

  const facteur = 2 / (periode + 1);
  let somme = 0;
  for (let i = 0; i < periode; i += 1) somme += valeurs[i]!;

  let precedent = somme / periode;
  sortie[periode - 1] = precedent;

  for (let i = periode; i < valeurs.length; i += 1) {
    precedent = (valeurs[i]! - precedent) * facteur + precedent;
    sortie[i] = precedent;
  }

  return sortie;
}

/** RSI de Wilder : lissage en 1/période, pas une moyenne simple. */
export function rsi(valeurs: readonly number[], periode = 14): Serie {
  const sortie: (number | null)[] = new Array(valeurs.length).fill(null);
  if (valeurs.length <= periode) return sortie;

  let gains = 0;
  let pertes = 0;
  for (let i = 1; i <= periode; i += 1) {
    const variation = valeurs[i]! - valeurs[i - 1]!;
    if (variation >= 0) gains += variation;
    else pertes -= variation;
  }

  let gainMoyen = gains / periode;
  let perteMoyenne = pertes / periode;
  sortie[periode] = valeurRsi(gainMoyen, perteMoyenne);

  for (let i = periode + 1; i < valeurs.length; i += 1) {
    const variation = valeurs[i]! - valeurs[i - 1]!;
    const gain = variation > 0 ? variation : 0;
    const perte = variation < 0 ? -variation : 0;

    gainMoyen = (gainMoyen * (periode - 1) + gain) / periode;
    perteMoyenne = (perteMoyenne * (periode - 1) + perte) / periode;
    sortie[i] = valeurRsi(gainMoyen, perteMoyenne);
  }

  return sortie;
}

function valeurRsi(gainMoyen: number, perteMoyenne: number): number {
  // Aucune perte sur la fenêtre : le RSI vaut 100 par définition, et diviser
  // par zéro donnerait NaN, qui se propagerait silencieusement.
  if (perteMoyenne === 0) return gainMoyen === 0 ? 50 : 100;
  const force = gainMoyen / perteMoyenne;
  return 100 - 100 / (1 + force);
}

export interface ResultatMacd {
  readonly macd: Serie;
  readonly signal: Serie;
  readonly histogramme: Serie;
}

export function macd(
  valeurs: readonly number[],
  periodeCourte = 12,
  periodeLongue = 26,
  periodeSignal = 9,
): ResultatMacd {
  const courte = moyenneMobileExponentielle(valeurs, periodeCourte);
  const longue = moyenneMobileExponentielle(valeurs, periodeLongue);

  const ligneMacd: (number | null)[] = valeurs.map((_, i) => {
    const c = courte[i];
    const l = longue[i];
    return c === null || c === undefined || l === null || l === undefined ? null : c - l;
  });

  // La ligne de signal est une EMA de la ligne MACD : on la calcule sur la
  // partie définie seulement, puis on la replace à son index d'origine.
  const debut = ligneMacd.findIndex((valeur) => valeur !== null);
  const signal: (number | null)[] = new Array(valeurs.length).fill(null);

  if (debut !== -1) {
    const compact = ligneMacd.slice(debut).map((valeur) => valeur as number);
    const emaSignal = moyenneMobileExponentielle(compact, periodeSignal);
    for (let i = 0; i < emaSignal.length; i += 1) signal[debut + i] = emaSignal[i] ?? null;
  }

  const histogramme: (number | null)[] = ligneMacd.map((valeur, i) => {
    const s = signal[i];
    return valeur === null || s === null || s === undefined ? null : valeur - s;
  });

  return { macd: ligneMacd, signal, histogramme };
}

/** ATR de Wilder, calculé sur le vrai range (gaps inclus). */
export function atr(chandeliers: readonly Chandelier[], periode = 14): Serie {
  const sortie: (number | null)[] = new Array(chandeliers.length).fill(null);
  if (chandeliers.length <= periode) return sortie;

  const ranges: number[] = [0];
  for (let i = 1; i < chandeliers.length; i += 1) {
    const bougie = chandeliers[i]!;
    const clotureVeille = chandeliers[i - 1]!.cloture;
    ranges.push(
      Math.max(
        bougie.haut - bougie.bas,
        Math.abs(bougie.haut - clotureVeille),
        Math.abs(bougie.bas - clotureVeille),
      ),
    );
  }

  let somme = 0;
  for (let i = 1; i <= periode; i += 1) somme += ranges[i]!;
  let precedent = somme / periode;
  sortie[periode] = precedent;

  for (let i = periode + 1; i < chandeliers.length; i += 1) {
    precedent = (precedent * (periode - 1) + ranges[i]!) / periode;
    sortie[i] = precedent;
  }

  return sortie;
}

/** Dernière valeur définie d'une série, ou `null` si elle n'existe pas. */
export function derniereValeur(serie: Serie): number | null {
  for (let i = serie.length - 1; i >= 0; i -= 1) {
    const valeur = serie[i];
    if (valeur !== null && valeur !== undefined) return valeur;
  }
  return null;
}

export function clotures(chandeliers: readonly Chandelier[]): number[] {
  return chandeliers.map((bougie) => bougie.cloture);
}
