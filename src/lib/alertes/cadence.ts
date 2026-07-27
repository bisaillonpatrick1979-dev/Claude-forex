/**
 * À quelle fréquence observer un symbole surveillé.
 *
 * Une cadence fixe est le mauvais compromis dans les deux sens. Toutes les cinq
 * minutes, c'est beaucoup trop souvent quand le cours est à deux cents points
 * du niveau le plus proche — il ne peut physiquement pas y arriver entre deux
 * observations — et beaucoup trop rare quand il est collé dessus, là où le
 * franchissement se joue à la seconde.
 *
 * L'idée : mesurer le temps qu'il faudrait au cours pour **atteindre** le
 * niveau, et observer plusieurs fois avant ce moment.
 *
 *     minutes pour atteindre ≈ distance / mouvement typique par minute
 *     intervalle             = minutes pour atteindre ÷ marge
 *
 * Le quota cesse alors d'être dépensé au hasard : il se concentre là où
 * quelque chose peut arriver. Sur un cours qui dérive loin de tout niveau, la
 * surveillance coûte quarante-huit appels par jour ; sur un cours qui teste une
 * résistance, elle passe à la minute. Une cadence fixe à cinq minutes coûte
 * 288 appels quoi qu'il arrive, et manque quand même le test.
 *
 * Ce n'est pas une prédiction : le mouvement typique par minute ne dit pas où
 * le cours ira, seulement à quelle vitesse il bouge d'habitude. La marge de
 * sécurité est là pour ça — on observe quatre fois plus souvent que le strict
 * nécessaire, précisément parce que l'estimation est grossière.
 */

/** Le cron ne peut pas descendre sous la minute : inutile de promettre mieux. */
export const INTERVALLE_MINIMUM_S = 60;

/**
 * Plafond d'espacement.
 *
 * Au-delà d'une demi-heure, une alerte cesse d'être une alerte. Même très loin
 * d'un niveau, on garde ce filet : un écart d'ouverture ou une publication
 * macro peut déplacer le cours bien plus vite que sa volatilité récente ne le
 * laissait attendre.
 */
export const INTERVALLE_MAXIMUM_S = 1800;

/**
 * Combien d'observations on veut avant que le cours puisse atteindre le niveau.
 *
 * Quatre : assez pour voir venir, assez peu pour ne pas gaspiller. À un, on
 * observerait pile au moment où le niveau est atteignable — donc trop tard une
 * fois sur deux.
 */
export const MARGE_OBSERVATIONS = 4;

export interface ContexteCadence {
  /** Écart absolu entre le cours et le niveau armé le plus proche, en prix. */
  readonly distance: number;
  /** Amplitude typique du mouvement sur une minute, en prix. */
  readonly volatiliteParMinute: number;
  readonly minimumS?: number;
  readonly maximumS?: number;
}

/**
 * Intervalle d'observation, en secondes.
 *
 * Rend toujours une valeur bornée, y compris sur des entrées absurdes : cette
 * fonction décide de la dépense d'un cron, et un `Infinity` ou un `NaN` y
 * arrêterait la surveillance sans le dire.
 */
export function intervalleObservation(contexte: ContexteCadence): number {
  const minimum = contexte.minimumS ?? INTERVALLE_MINIMUM_S;
  const maximum = Math.max(minimum, contexte.maximumS ?? INTERVALLE_MAXIMUM_S);

  const distance = Math.abs(contexte.distance);
  const volatilite = contexte.volatiliteParMinute;

  // Volatilité inconnue ou nulle : on ne sait pas estimer le temps de parcours.
  // On espace au maximum plutôt que de resserrer « au cas où » — resserrer sur
  // une inconnue dépense le quota sans rien acheter.
  if (!Number.isFinite(distance) || !Number.isFinite(volatilite) || volatilite <= 0) {
    return maximum;
  }

  const minutesPourAtteindre = distance / volatilite;
  const secondes = (minutesPourAtteindre * 60) / MARGE_OBSERVATIONS;

  if (!Number.isFinite(secondes)) return maximum;
  return Math.min(maximum, Math.max(minimum, Math.round(secondes)));
}

/**
 * Volatilité par minute déduite d'un ATR.
 *
 * L'ATR est exprimé par bougie ; le ramener à la minute suppose que le
 * mouvement se répartit uniformément dans la bougie. C'est faux dans le détail
 * — un mouvement se fait par à-coups — mais suffisant pour choisir une cadence,
 * et la marge d'observations absorbe l'erreur.
 */
export function volatiliteParMinute(atr: number | null, minutesParBougie: number): number {
  if (atr === null || !Number.isFinite(atr) || atr <= 0) return 0;
  if (!Number.isFinite(minutesParBougie) || minutesParBougie <= 0) return 0;
  return atr / minutesParBougie;
}

/**
 * Coût quotidien d'une cadence, en appels par symbole.
 *
 * Publié pour que le réglage se discute en chiffres plutôt qu'en impressions :
 * « toutes les minutes » et « toutes les cinq minutes » ne diffèrent pas d'un
 * facteur cinq dans le ressenti, mais bien de 1 152 appels par jour — soit,
 * sur le palier gratuit de Twelve Data, la différence entre tenir la journée et
 * l'épuiser avant midi.
 */
export function appelsParJour(intervalleS: number): number {
  if (!Number.isFinite(intervalleS) || intervalleS <= 0) return Number.POSITIVE_INFINITY;
  return Math.round((24 * 3600) / intervalleS);
}

/**
 * Distance au niveau armé le plus proche.
 *
 * Rend `null` quand aucun niveau n'est armé : il n'y a alors rien à surveiller,
 * et l'appelant doit sauter le symbole plutôt que de choisir une cadence.
 */
export function distanceAuNiveauLePlusProche(
  prix: number,
  niveaux: readonly number[],
): number | null {
  let meilleure: number | null = null;

  for (const niveau of niveaux) {
    if (!Number.isFinite(niveau)) continue;
    const ecart = Math.abs(prix - niveau);
    if (meilleure === null || ecart < meilleure) meilleure = ecart;
  }

  return meilleure;
}
