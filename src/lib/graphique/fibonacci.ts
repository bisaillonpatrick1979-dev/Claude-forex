/**
 * Niveaux de Fibonacci.
 *
 * Les ratios ne sont pas un choix esthétique : ce sont ceux que toutes les
 * plateformes affichent par défaut, et c'est **précisément** ce qui les rend
 * utiles. Un niveau de Fibonacci n'a aucune propriété physique ; il agit parce
 * qu'un grand nombre d'intervenants regardent le même trait au même endroit et
 * y placent des ordres. Changer les ratios pour des valeurs « meilleures »
 * romprait la seule chose qui fait fonctionner l'outil.
 *
 * Deux familles, souvent confondues :
 *
 *  - **Retracement** — de combien un mouvement revient en arrière. Les niveaux
 *    tombent *entre* les deux points choisis, 0 % au point d'arrivée et 100 %
 *    au point de départ.
 *  - **Extension** — jusqu'où le mouvement peut se prolonger *au-delà* du
 *    point d'arrivée. Les niveaux dépassent 100 %.
 *
 * L'ordre de saisie porte du sens et n'est pas commutatif : tracer d'un creux
 * vers un sommet n'est pas la même chose que l'inverse. On garde donc les deux
 * points tels que l'utilisateur les a posés, et c'est le calcul qui s'adapte.
 */

/** Ratios de retracement, dans l'ordre où les plateformes les affichent. */
export const RATIOS_RETRACEMENT: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Ratios d'extension.
 *
 * 1.272 et 1.618 sont les deux cibles classiques ; 2.618 sert aux mouvements
 * de forte amplitude. On inclut 1 pour que l'origine de l'extension reste
 * visible — sans elle, on ne sait plus d'où les projections partent.
 */
export const RATIOS_EXTENSION: readonly number[] = [1, 1.272, 1.618, 2, 2.618];

/** 0,5 n'est pas un ratio de Fibonacci ; il est là par convention de marché. */
export const RATIOS_NON_FIBONACCI: readonly number[] = [0, 0.5, 1, 2];

export interface NiveauFibonacci {
  readonly ratio: number;
  readonly prix: number;
  /** Étiquette affichée : « 61,8 % ». */
  readonly libelle: string;
  /** Vrai pour 0,5 et les entiers, qui ne dérivent pas de la suite. */
  readonly conventionnel: boolean;
}

/**
 * Niveaux de retracement entre deux prix.
 *
 * `depart` est l'origine du mouvement, `arrivee` son extrémité. Le ratio 0
 * tombe sur `arrivee` et le ratio 1 sur `depart` — c'est la convention de
 * toutes les plateformes, et l'inverser mettrait les étiquettes à l'envers
 * par rapport à ce qu'un trader lit ailleurs.
 */
export function niveauxRetracement(
  depart: number,
  arrivee: number,
  ratios: readonly number[] = RATIOS_RETRACEMENT,
): NiveauFibonacci[] {
  const amplitude = depart - arrivee;
  return ratios.map((ratio) => ({
    ratio,
    prix: arrivee + amplitude * ratio,
    libelle: formaterRatio(ratio),
    conventionnel: RATIOS_NON_FIBONACCI.includes(ratio),
  }));
}

/**
 * Niveaux d'extension au-delà de l'extrémité du mouvement.
 *
 * Même convention d'origine que le retracement : le ratio 1 tombe sur
 * `arrivee`, et les ratios supérieurs prolongent dans le sens du mouvement.
 * Un retracement à 1 et une extension à 1 désignent donc le même prix, ce qui
 * permet de superposer les deux outils sans discontinuité.
 */
export function niveauxExtension(
  depart: number,
  arrivee: number,
  ratios: readonly number[] = RATIOS_EXTENSION,
): NiveauFibonacci[] {
  const amplitude = arrivee - depart;
  return ratios.map((ratio) => ({
    ratio,
    prix: depart + amplitude * ratio,
    libelle: formaterRatio(ratio),
    conventionnel: RATIOS_NON_FIBONACCI.includes(ratio),
  }));
}

function formaterRatio(ratio: number): string {
  const pourcentage = ratio * 100;
  // 61,8 % plutôt que 61,80 % : les plateformes affichent le minimum de
  // décimales nécessaires, et un zéro superflu alourdit une échelle déjà dense.
  const texte = Number.isInteger(pourcentage)
    ? String(pourcentage)
    : pourcentage.toFixed(1).replace('.', ',');
  return `${texte} %`;
}

/**
 * Distance d'un prix au niveau le plus proche, en proportion de l'amplitude.
 *
 * C'est ce qui permet de dire « le prix est *sur* le 61,8 » plutôt que de
 * laisser un agent l'estimer à l'œil sur une image qu'il ne voit pas. Rendu en
 * fraction de l'amplitude totale et non en points : un seuil en points n'aurait
 * pas le même sens sur EUR/USD et sur NAS100.
 */
export interface ProximiteNiveau {
  readonly niveau: NiveauFibonacci;
  /** Écart absolu, en prix. */
  readonly ecart: number;
  /** Écart rapporté à l'amplitude du tracé, sans unité. */
  readonly ecartRelatif: number;
}

export function niveauLePlusProche(
  prix: number,
  niveaux: readonly NiveauFibonacci[],
  amplitude: number,
): ProximiteNiveau | null {
  if (niveaux.length === 0) return null;

  let meilleur = niveaux[0]!;
  let ecart = Math.abs(prix - meilleur.prix);

  for (const niveau of niveaux.slice(1)) {
    const candidat = Math.abs(prix - niveau.prix);
    if (candidat < ecart) {
      meilleur = niveau;
      ecart = candidat;
    }
  }

  const etendue = Math.abs(amplitude);
  return {
    niveau: meilleur,
    ecart,
    // Amplitude nulle : les niveaux sont confondus, aucune proximité relative
    // n'a de sens. On rend 0 plutôt qu'un Infinity qui polluerait l'affichage.
    ecartRelatif: etendue > 0 ? ecart / etendue : 0,
  };
}
