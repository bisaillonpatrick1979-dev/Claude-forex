/**
 * Séances de marché mondiales.
 *
 * Le Forex ne ferme pas, mais il ne se comporte pas de la même façon à toute
 * heure. Trois séances se succèdent et se chevauchent, et c'est le chevauchement
 * Londres–New York qui concentre l'essentiel du volume. Un agent qui ouvre une
 * position à 3 h UTC sur EUR/USD travaille dans un marché fin, où les spreads
 * s'élargissent et où un stop se fait toucher par du bruit.
 *
 * Les indices et les actions, eux, ferment réellement : le Nasdaq ne cote pas à
 * 3 h du matin, et une donnée qui existerait à cette heure-là viendrait d'un
 * marché hors séance, beaucoup moins liquide.
 *
 * Ce module ne fait que dire quelle séance est ouverte. Ce qu'on en fait — y
 * autoriser les agents ou non — est une décision de l'utilisateur, prise dans
 * la salle des marchés. Rien n'est bloqué par défaut : une contrainte imposée
 * sans être demandée est un piège, pas une protection.
 *
 * Tous les horaires sont en UTC. Ils ne tiennent pas compte de l'heure d'été,
 * qui décale Londres et New York d'une heure une partie de l'année : c'est une
 * approximation assumée, documentée dans NOTES.md, et l'écart d'une heure ne
 * change pas la nature du raisonnement (« sommes-nous en séance active ? »).
 */

export type CodeSeance = 'SYDNEY' | 'TOKYO' | 'LONDRES' | 'NEW_YORK';

export interface Seance {
  readonly code: CodeSeance;
  readonly nom: string;
  /** Heure d'ouverture en UTC, minutes depuis minuit. */
  readonly ouvertureUtc: number;
  readonly fermetureUtc: number;
  readonly description: string;
}

const H = (heures: number, minutes = 0): number => heures * 60 + minutes;

export const SEANCES: readonly Seance[] = [
  {
    code: 'SYDNEY',
    nom: 'Sydney',
    ouvertureUtc: H(21),
    fermetureUtc: H(6),
    description: 'Ouvre la semaine. Volume faible, mouvements limités.',
  },
  {
    code: 'TOKYO',
    nom: 'Tokyo',
    ouvertureUtc: H(0),
    fermetureUtc: H(9),
    description: 'Séance asiatique. Porte le yen, l’aussie et le kiwi.',
  },
  {
    code: 'LONDRES',
    nom: 'Londres',
    ouvertureUtc: H(8),
    fermetureUtc: H(17),
    description: 'La plus liquide sur le Forex. Ouvre souvent la tendance du jour.',
  },
  {
    code: 'NEW_YORK',
    nom: 'New York',
    ouvertureUtc: H(13),
    fermetureUtc: H(22),
    description: 'Indices américains et statistiques. Chevauche Londres de 13 h à 17 h.',
  },
];

/** Le marché des changes ferme du vendredi 22 h UTC au dimanche 21 h UTC. */
export function weekEndForex(horodatageSecondes: number): boolean {
  const date = new Date(horodatageSecondes * 1000);
  const jour = date.getUTCDay();
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();

  if (jour === 6) return true; // samedi entier
  if (jour === 5 && minutes >= H(22)) return true; // vendredi soir
  if (jour === 0 && minutes < H(21)) return true; // dimanche avant la réouverture
  return false;
}

/** Une séance qui franchit minuit est ouverte de part et d'autre. */
function dansLaPlage(minutes: number, seance: Seance): boolean {
  if (seance.ouvertureUtc <= seance.fermetureUtc) {
    return minutes >= seance.ouvertureUtc && minutes < seance.fermetureUtc;
  }
  return minutes >= seance.ouvertureUtc || minutes < seance.fermetureUtc;
}

export function seancesOuvertes(horodatageSecondes: number): readonly CodeSeance[] {
  if (weekEndForex(horodatageSecondes)) return [];

  const date = new Date(horodatageSecondes * 1000);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();

  return SEANCES.filter((seance) => dansLaPlage(minutes, seance)).map((seance) => seance.code);
}

export interface VerdictSeance {
  readonly autorise: boolean;
  readonly raison: string;
  readonly ouvertes: readonly CodeSeance[];
}

/**
 * Les agents ont-ils le droit de travailler à cet instant ?
 *
 * Une sélection vide vaut « aucune restriction » — même convention que le
 * périmètre d'instruments. L'inverser ici donnerait deux sémantiques à la même
 * idée dans la même application.
 *
 * Le week-end est traité à part : ce n'est pas une séance fermée parmi
 * d'autres, c'est un marché qui ne cote pas. Y autoriser les agents n'aurait
 * aucun sens, quelle que soit leur sélection.
 */
export function seanceAutorisee(
  seancesChoisies: readonly CodeSeance[],
  horodatageSecondes: number,
): VerdictSeance {
  const ouvertes = seancesOuvertes(horodatageSecondes);

  if (weekEndForex(horodatageSecondes)) {
    return {
      autorise: false,
      raison:
        'Marché des changes fermé — du vendredi 22 h au dimanche 21 h UTC. Les agents reprennent à la réouverture de Sydney.',
      ouvertes: [],
    };
  }

  if (seancesChoisies.length === 0) {
    return { autorise: true, raison: 'Aucune restriction de séance.', ouvertes };
  }

  const active = seancesChoisies.filter((choisie) => ouvertes.includes(choisie));
  if (active.length > 0) {
    return {
      autorise: true,
      raison: `Séance ${active.map(nomSeance).join(' et ')} ouverte.`,
      ouvertes,
    };
  }

  return {
    autorise: false,
    raison:
      ouvertes.length === 0
        ? 'Aucune séance ouverte actuellement.'
        : `Séance ${ouvertes.map(nomSeance).join(' et ')} ouverte, mais vous avez restreint les agents à ${seancesChoisies.map(nomSeance).join(', ')}.`,
    ouvertes,
  };
}

export function nomSeance(code: CodeSeance): string {
  return SEANCES.find((seance) => seance.code === code)?.nom ?? code;
}

/**
 * Ordre de liquidité, du plus porteur au plus calme.
 *
 * Sert à désigner *une* séance quand plusieurs se chevauchent. Ce n'est pas un
 * classement de qualité : c'est l'ordre dans lequel un trader nomme l'heure à
 * laquelle il a agi. À 14 h UTC, Londres et New York sont ouvertes toutes les
 * deux, et personne ne dit « j'ai pris ça sur Tokyo ».
 */
const ORDRE_LIQUIDITE: readonly CodeSeance[] = ['LONDRES', 'NEW_YORK', 'TOKYO', 'SYDNEY'];

/** Chevauchements qui portent un nom dans le métier, et méritent d'être dits. */
const CHEVAUCHEMENTS: readonly { readonly paire: readonly [CodeSeance, CodeSeance]; readonly nom: string }[] =
  [
    { paire: ['LONDRES', 'NEW_YORK'], nom: 'Londres × New York' },
    { paire: ['TOKYO', 'LONDRES'], nom: 'Tokyo × Londres' },
    { paire: ['SYDNEY', 'TOKYO'], nom: 'Sydney × Tokyo' },
  ];

export interface EtatSeances {
  readonly ouvertes: readonly CodeSeance[];
  /** Séance à laquelle rattacher une décision prise à cet instant. */
  readonly dominante: CodeSeance | null;
  /** Nom du chevauchement en cours, s'il en porte un. */
  readonly chevauchement: string | null;
  readonly weekEnd: boolean;
  /** Prochain instant où une séance ouvre ou ferme, en secondes UTC. */
  readonly prochainChangement: number | null;
}

/**
 * Photographie des séances à un instant donné.
 *
 * Tout se déduit de l'horodatage : rien n'est stocké, donc rien ne peut
 * diverger. Une décision prise il y a trois mois se rattache à sa séance aussi
 * sûrement qu'une décision prise à l'instant, et un correctif sur les horaires
 * corrige l'historique du même coup.
 */
export function etatSeances(horodatageSecondes: number): EtatSeances {
  const weekEnd = weekEndForex(horodatageSecondes);
  const ouvertes = seancesOuvertes(horodatageSecondes);

  const dominante =
    ORDRE_LIQUIDITE.find((code) => ouvertes.includes(code)) ?? null;

  const chevauchement =
    CHEVAUCHEMENTS.find(
      ({ paire }) => ouvertes.includes(paire[0]) && ouvertes.includes(paire[1]),
    )?.nom ?? null;

  return {
    ouvertes,
    dominante,
    chevauchement,
    weekEnd,
    prochainChangement: prochainChangementSeance(horodatageSecondes),
  };
}

/**
 * Prochain instant où la liste des séances ouvertes change.
 *
 * Balayage par pas d'une minute sur une semaine. Une recherche analytique sur
 * quatre plages qui franchissent minuit, plus le week-end, serait plus rapide
 * et bien plus facile à casser ; ici le pas de balayage *est* la définition de
 * la précision affichée, et il se relit sans crayon.
 */
export function prochainChangementSeance(horodatageSecondes: number): number | null {
  const depart = seancesOuvertes(horodatageSecondes);
  const memeEnsemble = (autre: readonly CodeSeance[]) =>
    autre.length === depart.length && autre.every((code) => depart.includes(code));

  for (let pas = 1; pas <= 60 * 24 * 7; pas += 1) {
    const instant = horodatageSecondes + pas * 60;
    if (!memeEnsemble(seancesOuvertes(instant))) return instant;
  }
  return null;
}

/**
 * Rattache un horodatage à sa séance, pour l'afficher à côté d'un trade.
 *
 * Rend `null` hors marché plutôt qu'une séance par défaut : un ordre passé le
 * samedi n'appartient à aucune séance, et prétendre le contraire serait une
 * donnée inventée.
 */
export function seanceDe(horodatageSecondes: number): CodeSeance | null {
  return etatSeances(horodatageSecondes).dominante;
}

/** Libellé court pour une pastille : « Londres », « Londres × New York ». */
export function libelleSeance(horodatageSecondes: number): string {
  const etat = etatSeances(horodatageSecondes);
  if (etat.weekEnd) return 'Hors marché';
  if (etat.chevauchement) return etat.chevauchement;
  if (etat.dominante) return nomSeance(etat.dominante);
  return 'Aucune séance';
}

/** Prochaine ouverture d'une des séances choisies, pour afficher l'attente. */
export function prochaineOuverture(
  seancesChoisies: readonly CodeSeance[],
  horodatageSecondes: number,
): number | null {
  const cibles = seancesChoisies.length > 0 ? seancesChoisies : SEANCES.map((s) => s.code);

  // Recherche par pas de quinze minutes sur une semaine : la précision suffit
  // pour un message d'attente, et le calcul reste trivial à vérifier.
  for (let pas = 1; pas <= 4 * 24 * 7; pas += 1) {
    const instant = horodatageSecondes + pas * 900;
    if (weekEndForex(instant)) continue;
    const ouvertes = seancesOuvertes(instant);
    if (cibles.some((cible) => ouvertes.includes(cible))) return instant;
  }
  return null;
}
