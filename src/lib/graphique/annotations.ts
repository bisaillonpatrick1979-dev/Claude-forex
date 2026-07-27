import {
  niveauLePlusProche,
  niveauxExtension,
  niveauxRetracement,
  type NiveauFibonacci,
} from './fibonacci';

/**
 * Annotations de graphique : les traits que le trader pose lui-même.
 *
 * L'ambition n'est pas de recopier les soixante-huit outils d'une plateforme
 * commerciale. C'est d'avoir les cinq qui portent l'essentiel du travail réel
 * — et d'en faire quelque chose qu'aucune plateforme commerciale ne fait.
 *
 * **La différence.** Sur TradingView, un trait est un pixel : la plateforme
 * sait le dessiner et le sauvegarder, elle ne sait pas le *lire*. Ici, les
 * annotations entrent dans l'instantané remis aux agents. Quand le trader
 * marque une résistance à 1,0920, les agents la voient, la nomment, et doivent
 * s'expliquer s'ils proposent d'acheter au travers. Le graphique cesse d'être
 * un affichage pour devenir une entrée.
 *
 * D'où la contrainte qui gouverne ce module : **tout doit être descriptible en
 * mots**. Un outil qu'on ne peut pas résumer en une phrase compréhensible par
 * un modèle n'a pas sa place ici, quelle que soit sa beauté à l'écran.
 */

export const OUTILS = [
  'NIVEAU',
  'TENDANCE',
  'FIBONACCI',
  'FIBONACCI_EXTENSION',
  'ZONE',
  'NOTE',
] as const;

export type Outil = (typeof OUTILS)[number];

export const LIBELLES_OUTIL: Readonly<Record<Outil, string>> = {
  NIVEAU: 'Niveau horizontal',
  TENDANCE: 'Ligne de tendance',
  FIBONACCI: 'Retracement Fibonacci',
  FIBONACCI_EXTENSION: 'Extension Fibonacci',
  ZONE: 'Zone',
  NOTE: 'Note',
};

/** Nombre de points que l'utilisateur doit poser pour chaque outil. */
export const POINTS_REQUIS: Readonly<Record<Outil, 1 | 2>> = {
  NIVEAU: 1,
  TENDANCE: 2,
  FIBONACCI: 2,
  FIBONACCI_EXTENSION: 2,
  ZONE: 2,
  NOTE: 1,
};

export interface PointGraphique {
  /** Secondes UTC, comme partout ailleurs dans le projet. */
  readonly horodatage: number;
  readonly prix: number;
}

export interface Annotation {
  readonly id: string;
  readonly symbole: string;
  /** `null` = visible sur toutes les unités de temps. Une résistance
   *  journalière ne cesse pas d'exister parce qu'on passe en M5. */
  readonly intervalle: string | null;
  readonly outil: Outil;
  readonly points: readonly PointGraphique[];
  readonly couleur: string;
  readonly libelle: string | null;
}

export const COULEURS_ANNOTATION: readonly { code: string; nom: string }[] = [
  { code: '#4c9aff', nom: 'Bleu' },
  { code: '#22c55e', nom: 'Vert' },
  { code: '#ef4444', nom: 'Rouge' },
  { code: '#f59e0b', nom: 'Ambre' },
  { code: '#c084fc', nom: 'Violet' },
  { code: '#94a3b8', nom: 'Gris' },
];

export const COULEUR_DEFAUT = '#4c9aff';

/**
 * En deçà de cet écart — rapporté à l'amplitude du tracé — on dit que le cours
 * est *sur* le niveau.
 *
 * Le seuil se raisonne à partir de l'espacement des niveaux, pas au jugé. Le
 * plus petit intervalle d'un retracement standard est 0,382 → 0,5, soit 11,8 %
 * de l'amplitude ; la moitié, 5,9 %, est la distance maximale possible à un
 * niveau. Un seuil à 1 % couvre donc environ un sixième de cet espace : assez
 * pour attraper un cours réellement collé au trait, trop peu pour le dire d'un
 * cours qui flotte entre deux niveaux. À 2 %, un tiers de l'espace était
 * qualifié de « dessus », ce qui vidait l'expression de son sens.
 */
export const SEUIL_SUR_NIVEAU = 0.01;

/** Une annotation s'applique-t-elle à ce que l'écran montre ? */
export function annotationVisible(
  annotation: Annotation,
  symbole: string,
  intervalle: string,
): boolean {
  if (annotation.symbole !== symbole) return false;
  return annotation.intervalle === null || annotation.intervalle === intervalle;
}

/**
 * Niveaux de prix portés par une annotation.
 *
 * Un niveau horizontal en porte un, un Fibonacci en porte sept, une tendance
 * n'en porte aucun de fixe — sa valeur dépend de l'instant où on la lit. C'est
 * cette liste qui alimente à la fois le rendu et le texte remis aux agents,
 * pour qu'aucun des deux ne puisse décrire autre chose que l'autre.
 */
export function niveauxAnnotation(annotation: Annotation): readonly NiveauFibonacci[] {
  const [premier, second] = annotation.points;

  switch (annotation.outil) {
    case 'NIVEAU':
      return premier
        ? [{ ratio: 0, prix: premier.prix, libelle: '', conventionnel: false }]
        : [];

    case 'FIBONACCI':
      return premier && second ? niveauxRetracement(premier.prix, second.prix) : [];

    case 'FIBONACCI_EXTENSION':
      return premier && second ? niveauxExtension(premier.prix, second.prix) : [];

    case 'ZONE':
      // Les deux bords : ce sont eux qu'on franchit ou qu'on respecte.
      return premier && second
        ? [
            { ratio: 0, prix: Math.min(premier.prix, second.prix), libelle: 'bas', conventionnel: false },
            { ratio: 1, prix: Math.max(premier.prix, second.prix), libelle: 'haut', conventionnel: false },
          ]
        : [];

    case 'TENDANCE':
    case 'NOTE':
      return [];
  }
}

/**
 * Prix d'une ligne de tendance à un instant donné.
 *
 * Prolongée au-delà de son second point : c'est tout l'intérêt d'une tendance,
 * et une plateforme qui s'arrêterait au dernier point posé obligerait à
 * redessiner à chaque bougie. Rend `null` quand les deux points partagent le
 * même horodatage — la droite serait verticale, donc sans prix défini.
 */
export function prixTendance(annotation: Annotation, horodatage: number): number | null {
  if (annotation.outil !== 'TENDANCE') return null;
  const [a, b] = annotation.points;
  if (!a || !b || a.horodatage === b.horodatage) return null;

  const pente = (b.prix - a.prix) / (b.horodatage - a.horodatage);
  return a.prix + pente * (horodatage - a.horodatage);
}

export interface AnnotationDecrite {
  readonly annotation: Annotation;
  /** Une phrase, lisible par un humain comme par un modèle. */
  readonly texte: string;
}

/**
 * Traduction d'une annotation en phrase.
 *
 * C'est la fonction qui justifie tout le module : sans elle, les traits
 * resteraient décoratifs. Le prix courant est passé pour situer le marché par
 * rapport au tracé — « sous la résistance » vaut mieux que « résistance à
 * 1,0920 », qui oblige le lecteur à faire la comparaison lui-même.
 */
export function decrireAnnotation(
  annotation: Annotation,
  prixCourant: number,
  decimales: number,
): AnnotationDecrite {
  const nom = annotation.libelle?.trim();
  const prefixe = nom ? `« ${nom} » — ` : '';
  const p = (valeur: number) => valeur.toFixed(decimales);

  switch (annotation.outil) {
    case 'NIVEAU': {
      const niveau = annotation.points[0];
      if (!niveau) return { annotation, texte: `${prefixe}niveau incomplet.` };
      const cote = prixCourant > niveau.prix ? 'au-dessus' : 'au-dessous';
      const role = prixCourant > niveau.prix ? 'support potentiel' : 'résistance potentielle';
      return {
        annotation,
        texte: `${prefixe}niveau horizontal à ${p(niveau.prix)} ; le prix est ${cote} (${role}).`,
      };
    }

    case 'TENDANCE': {
      const [a, b] = annotation.points;
      if (!a || !b) return { annotation, texte: `${prefixe}tendance incomplète.` };
      const sens = b.prix > a.prix ? 'haussière' : b.prix < a.prix ? 'baissière' : 'horizontale';
      return {
        annotation,
        texte:
          `${prefixe}ligne de tendance ${sens}, de ${p(a.prix)} à ${p(b.prix)}. ` +
          `Son prix évolue avec le temps : la comparer au cours à l'instant considéré, pas à sa valeur de tracé.`,
      };
    }

    case 'FIBONACCI':
    case 'FIBONACCI_EXTENSION': {
      const [a, b] = annotation.points;
      if (!a || !b) return { annotation, texte: `${prefixe}tracé Fibonacci incomplet.` };
      const niveaux = niveauxAnnotation(annotation);
      const proche = niveauLePlusProche(prixCourant, niveaux, b.prix - a.prix);
      const type =
        annotation.outil === 'FIBONACCI' ? 'Retracement Fibonacci' : 'Extension Fibonacci';

      const liste = niveaux.map((niveau) => `${niveau.libelle} = ${p(niveau.prix)}`).join(' ; ');
      const situation = proche
        ? ` Le cours (${p(prixCourant)}) est le plus proche du ${proche.niveau.libelle}` +
          `${proche.ecartRelatif < SEUIL_SUR_NIVEAU ? ', pratiquement dessus' : ''}.`
        : '';

      return {
        annotation,
        texte: `${prefixe}${type} de ${p(a.prix)} vers ${p(b.prix)} : ${liste}.${situation}`,
      };
    }

    case 'ZONE': {
      const [a, b] = annotation.points;
      if (!a || !b) return { annotation, texte: `${prefixe}zone incomplète.` };
      const bas = Math.min(a.prix, b.prix);
      const haut = Math.max(a.prix, b.prix);
      const position =
        prixCourant > haut ? 'au-dessus' : prixCourant < bas ? 'au-dessous' : 'à l’intérieur';
      return {
        annotation,
        texte: `${prefixe}zone de ${p(bas)} à ${p(haut)} ; le prix est ${position}.`,
      };
    }

    case 'NOTE': {
      const point = annotation.points[0];
      return {
        annotation,
        texte: nom
          ? `Note du trader${point ? ` à ${p(point.prix)}` : ''} : ${nom}`
          : 'Note sans contenu.',
      };
    }
  }
}

/**
 * Bloc remis aux agents.
 *
 * Volontairement précédé de ce que les annotations **sont** : des hypothèses
 * humaines, pas des faits de marché. Un agent qui les prendrait pour des
 * mesures objectives raisonnerait mieux qu'il ne le devrait sur un trait posé
 * à la main. Il doit pouvoir être en désaccord — et le dire.
 */
export function bloc(
  annotations: readonly Annotation[],
  prixCourant: number,
  decimales: number,
): string {
  if (annotations.length === 0) return '';

  const lignes = annotations
    .map((annotation) => `- ${decrireAnnotation(annotation, prixCourant, decimales).texte}`)
    .join('\n');

  return (
    'Repères tracés par le trader sur ce graphique. Ce sont des hypothèses humaines, ' +
    'pas des mesures : elles indiquent où son attention se porte. Les prendre en compte ' +
    'explicitement — les confirmer ou les contredire, avec un motif — plutôt que les ignorer ' +
    'ou les accepter d’office.\n' +
    lignes
  );
}
