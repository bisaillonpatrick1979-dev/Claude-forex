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
