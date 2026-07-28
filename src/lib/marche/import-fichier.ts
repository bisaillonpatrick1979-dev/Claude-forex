import type { Chandelier } from './types';

/**
 * Import de bougies depuis un fichier.
 *
 * Ce que ça débloque : le palier gratuit de Twelve Data ne donne pas quinze ans
 * d'historique, et le générateur simulé ne donnera jamais de vrais mouvements.
 * Un fichier téléchargé une fois — chez Twelve Data, chez un courtier, chez
 * Dukascopy — apporte l'historique complet sans consommer un seul appel, et
 * pour de bon : ce qui est en base y reste.
 *
 * **La règle qui gouverne ce module : refuser plutôt que deviner.** Un import
 * qui se trompe ne produit pas une erreur visible, il produit un historique
 * plausible et faux — sur lequel on backteste, sur lequel les agents
 * raisonnent, et dont on ne remet jamais en cause l'origine. Chaque ambiguïté
 * est donc signalée et bloque l'import, plutôt que d'être tranchée au petit
 * bonheur.
 *
 * Le cas d'école est la date. `03/04/2024` peut être le 3 avril ou le 4 mars.
 * Deviner, c'est décaler tout un historique d'un mois une fois sur deux — assez
 * pour fausser chaque backtest sans que rien ne le montre.
 */

export const FORMATS_ACCEPTES = ['csv', 'json'] as const;
export type FormatFichier = (typeof FORMATS_ACCEPTES)[number];

export interface AnomalieImport {
  /** Numéro de ligne dans le fichier, 1 pour la première. `null` = global. */
  readonly ligne: number | null;
  readonly message: string;
}

export interface ResultatImport {
  readonly chandeliers: readonly Chandelier[];
  /** Lignes rejetées, avec leur motif. Jamais silencieuses. */
  readonly anomalies: readonly AnomalieImport[];
  /** Colonnes reconnues, pour que l'utilisateur vérifie l'interprétation. */
  readonly colonnes: Readonly<Record<string, string>>;
  /** Vrai quand le fichier est inexploitable : rien ne doit être écrit. */
  readonly bloquant: boolean;
}

/**
 * Noms de colonnes reconnus, par rôle.
 *
 * La liste vient de ce que produisent réellement les sources courantes :
 * Twelve Data (`datetime`), MetaTrader (`<DATE>`, `<OPEN>`), Dukascopy
 * (`Gmt time`), TradingView (`time`), et les exports francisés. Chercher une
 * correspondance exacte sur une liste connue vaut mieux qu'une heuristique
 * floue : on sait dire « colonne non reconnue » au lieu de prendre la mauvaise.
 */
const SYNONYMES: Readonly<Record<string, readonly string[]>> = {
  horodatage: [
    'datetime', 'date', 'time', 'timestamp', 'date_time', 'gmt time', 'local time',
    'horodatage', 'date/heure', 'dateheure', '<date>', '<dtyyyymmdd>', 'index',
  ],
  // `time` figure aussi dans les synonymes d'horodatage : certains exports
  // n'ont que cette colonne. Quand un fichier porte `date` *et* `time`, la
  // première prend le rôle d'horodatage et la seconde retombe ici — d'où la
  // résolution de rôle qui essaie le suivant quand le premier est déjà pris.
  heure: ['<time>', 'time', 'hour', 'heure'],
  ouverture: ['open', 'ouverture', 'o', '<open>'],
  haut: ['high', 'haut', 'h', 'max', '<high>'],
  bas: ['low', 'bas', 'b', 'l', 'min', '<low>'],
  cloture: ['close', 'cloture', 'clôture', 'c', 'dernier', 'last', '<close>', 'adj close'],
  volume: ['volume', 'vol', 'v', '<vol>', '<tickvol>', 'tick volume'],
};

function normaliser(entete: string): string {
  return entete.trim().toLowerCase().replace(/^"|"$/g, '').replace(/\s+/g, ' ');
}

/**
 * Rôle d'une colonne, en tenant compte de ceux déjà attribués.
 *
 * Un même nom peut servir deux rôles selon le contexte : `time` est
 * l'horodatage quand il est seul, l'heure quand une colonne `date`
 * l'accompagne. Sans ce second essai, un export `date,time,open,…` perdait
 * l'heure et ramenait toutes les bougies à minuit.
 */
function roleDeColonne(entete: string, dejaPris: ReadonlySet<string> = new Set()): string | null {
  const propre = normaliser(entete);
  let repli: string | null = null;

  for (const [role, noms] of Object.entries(SYNONYMES)) {
    if (!noms.includes(propre)) continue;
    if (!dejaPris.has(role)) return role;
    repli ??= role;
  }
  return repli === null ? null : null;
}

/**
 * Séparateur d'un CSV, déduit de la ligne d'en-tête.
 *
 * On compte les candidats plutôt que de supposer la virgule : les exports
 * européens utilisent le point-virgule, MetaTrader la tabulation. Se tromper
 * ici donne une seule colonne et un message incompréhensible.
 */
export function detecterSeparateur(entete: string): string {
  const candidats = [',', ';', '\t', '|'];
  let meilleur = ',';
  let maximum = 0;

  for (const candidat of candidats) {
    const compte = entete.split(candidat).length - 1;
    if (compte > maximum) {
      maximum = compte;
      meilleur = candidat;
    }
  }
  return meilleur;
}

/** Découpe une ligne CSV en respectant les guillemets. */
function decouper(ligne: string, separateur: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let dansGuillemets = false;

  for (let index = 0; index < ligne.length; index += 1) {
    const caractere = ligne[index]!;

    if (caractere === '"') {
      // Deux guillemets consécutifs à l'intérieur d'un champ : un guillemet
      // littéral, pas une fin de champ.
      if (dansGuillemets && ligne[index + 1] === '"') {
        courant += '"';
        index += 1;
        continue;
      }
      dansGuillemets = !dansGuillemets;
      continue;
    }

    if (caractere === separateur && !dansGuillemets) {
      champs.push(courant);
      courant = '';
      continue;
    }
    courant += caractere;
  }

  champs.push(courant);
  return champs;
}

export type SeparateurDecimal = '.' | ',';

/**
 * Séparateur décimal du fichier, déduit de l'ensemble des valeurs.
 *
 * La décision ne peut pas se prendre nombre par nombre : `1,085` est
 * indiscernable entre « mille quatre-vingt-cinq » et « un virgule zéro
 * quatre-vingt-cinq ». Sur un fichier de prix, se tromper multiplie tout par
 * mille — et comme les quatre valeurs OHLC subissent le même facteur, le
 * contrôle de cohérence ne voit rien passer. Un historique mille fois trop
 * grand entrerait sans un mot.
 *
 * On raisonne donc sur le fichier, comme pour l'ordre jour/mois :
 *
 *  1. un nombre contenant **les deux** signes tranche à lui seul — le dernier
 *     est le décimal, l'autre sépare les milliers ;
 *  2. sinon, un nombre dont le groupe final n'a pas exactement trois chiffres
 *     tranche : un groupe de milliers en a toujours trois.
 *
 * Rend `null` quand aucune valeur ne tranche — tous les nombres ressemblent
 * alors à `1,085`, et l'appelant devra assumer une hypothèse.
 */
export function separateurDecimal(echantillons: readonly string[]): SeparateurDecimal | null {
  for (const brut of echantillons) {
    const propre = brut.trim().replace(/^"|"$/g, '');
    const dernierPoint = propre.lastIndexOf('.');
    const derniereVirgule = propre.lastIndexOf(',');
    if (dernierPoint >= 0 && derniereVirgule >= 0) {
      return dernierPoint > derniereVirgule ? '.' : ',';
    }
  }

  for (const brut of echantillons) {
    const propre = brut.trim().replace(/^"|"$/g, '');
    const trouve = /^[+-]?\d+([.,])(\d+)$/.exec(propre);
    if (trouve && trouve[2]!.length !== 3) return trouve[1] as SeparateurDecimal;
  }

  // Dernier départage : le fichier n'emploie qu'un seul des deux signes, et
  // toujours devant trois chiffres. Un fichier de cotations qui grouperait les
  // milliers aurait besoin de l'autre signe pour ses décimales — son absence
  // désigne donc le signe présent comme décimal. Reste le cas d'un fichier de
  // prix entiers groupés par milliers, plus rare, et que la note de fin
  // signale à la relecture.
  const avecPoint = echantillons.some((brut) => brut.includes('.'));
  const avecVirgule = echantillons.some((brut) => brut.includes(','));
  if (avecVirgule && !avecPoint) return ',';
  if (avecPoint && !avecVirgule) return '.';

  return null;
}

/**
 * Nombre écrit à l'européenne ou à l'anglaise.
 *
 * Le séparateur décimal est imposé par l'appelant, qui l'a déduit du fichier
 * entier. À défaut, le point : un fichier de cotations qui n'a pas tranché
 * contient presque toujours des décimales, jamais des milliers.
 */
export function lireNombre(brut: string, decimal: SeparateurDecimal | null = null): number | null {
  const propre = brut
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s|\u00a0/g, '');
  if (propre === '') return null;

  const choisi: SeparateurDecimal = decimal ?? '.';
  const millier = choisi === '.' ? ',' : '.';

  const normalise = propre.split(millier).join('').replace(choisi, '.');
  const valeur = Number(normalise);
  return Number.isFinite(valeur) ? valeur : null;
}

export interface LectureDate {
  readonly horodatage: number | null;
  /** Motif du refus, quand la date est ambiguë ou illisible. */
  readonly refus: string | null;
}

/**
 * Date d'une bougie, en secondes UTC.
 *
 * Les formats non ambigus sont acceptés : ISO 8601, `AAAA-MM-JJ`, `AAAAMMJJ`,
 * horodatage Unix. Les formats à composantes inversables — `JJ/MM/AAAA` contre
 * `MM/JJ/AAAA` — sont acceptés **seulement** quand l'ordre est déductible,
 * c'est-à-dire quand la première composante dépasse douze. Sinon on refuse.
 *
 * Refuser paraît sévère pour une seule ligne. C'est le contraire : l'ordre se
 * décide sur le **fichier entier** (`ordreJourMois`), à partir des lignes qui
 * lèvent l'ambiguïté. Une seule ligne où le jour dépasse douze suffit à trancher
 * pour tout le reste. Un fichier où aucune ligne ne tranche est un fichier dont
 * on ne peut pas connaître les dates — et il vaut mieux le dire.
 */
export function lireDate(brut: string, jourEnPremier: boolean | null): LectureDate {
  const propre = brut.trim().replace(/^"|"$/g, '');
  if (propre === '') return { horodatage: null, refus: 'date vide' };

  // Horodatage Unix, en secondes ou en millisecondes.
  if (/^\d{9,13}$/.test(propre)) {
    const valeur = Number(propre);
    const secondes = propre.length >= 12 ? Math.floor(valeur / 1000) : valeur;
    return { horodatage: secondes, refus: null };
  }

  // AAAAMMJJ compact, sans séparateur.
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(propre);
  if (compact) {
    return versHorodatage(Number(compact[1]), Number(compact[2]), Number(compact[3]), 0, 0, 0);
  }

  // Année en tête : l'ordre n'est jamais ambigu.
  const isoLike = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    propre,
  );
  if (isoLike) {
    return versHorodatage(
      Number(isoLike[1]),
      Number(isoLike[2]),
      Number(isoLike[3]),
      Number(isoLike[4] ?? 0),
      Number(isoLike[5] ?? 0),
      Number(isoLike[6] ?? 0),
    );
  }

  // Jour et mois en tête : ordre à déterminer.
  const jourMois = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    propre,
  );
  if (jourMois) {
    const premier = Number(jourMois[1]);
    const second = Number(jourMois[2]);
    const anneeBrute = Number(jourMois[3]);
    const annee = anneeBrute < 100 ? 2000 + anneeBrute : anneeBrute;

    let jour: number;
    let mois: number;

    if (premier > 12 && second <= 12) {
      jour = premier;
      mois = second;
    } else if (second > 12 && premier <= 12) {
      jour = second;
      mois = premier;
    } else if (jourEnPremier === null) {
      return {
        horodatage: null,
        refus: `date « ${propre} » ambiguë : impossible de savoir si le jour ou le mois vient en premier`,
      };
    } else {
      jour = jourEnPremier ? premier : second;
      mois = jourEnPremier ? second : premier;
    }

    return versHorodatage(
      annee,
      mois,
      jour,
      Number(jourMois[4] ?? 0),
      Number(jourMois[5] ?? 0),
      Number(jourMois[6] ?? 0),
    );
  }

  // Dernier recours : ce que le moteur JavaScript sait lire. Volontairement en
  // dernier — `Date.parse` accepte des choses surprenantes et interprète
  // certains formats dans le fuseau local, ce qui décalerait les bougies.
  const analyse = Date.parse(`${propre}Z`);
  if (Number.isFinite(analyse)) return { horodatage: Math.floor(analyse / 1000), refus: null };

  return { horodatage: null, refus: `date « ${propre} » illisible` };
}

function versHorodatage(
  annee: number,
  mois: number,
  jour: number,
  heure: number,
  minute: number,
  seconde: number,
): LectureDate {
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) {
    return { horodatage: null, refus: `date invalide (${annee}-${mois}-${jour})` };
  }
  const valeur = Date.UTC(annee, mois - 1, jour, heure, minute, seconde);
  if (!Number.isFinite(valeur)) return { horodatage: null, refus: 'date invalide' };
  return { horodatage: Math.floor(valeur / 1000), refus: null };
}

/**
 * Ordre jour/mois déduit du fichier entier.
 *
 * `true` = jour en premier, `false` = mois en premier, `null` = indéterminable.
 * On cherche la première ligne où une composante dépasse douze : elle tranche
 * pour tout le fichier. C'est ce qui permet d'accepter des dates que la lecture
 * ligne à ligne refuserait.
 */
export function ordreJourMois(dates: readonly string[]): boolean | null {
  for (const brut of dates) {
    const trouve = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(brut.trim().replace(/^"/, ''));
    if (!trouve) continue;
    const premier = Number(trouve[1]);
    const second = Number(trouve[2]);
    if (premier > 12 && second <= 12) return true;
    if (second > 12 && premier <= 12) return false;
  }
  return null;
}

/** Bougie candidate, avant contrôle de cohérence. */
interface Brouillon {
  readonly ligne: number;
  readonly horodatage: number;
  readonly ouverture: number;
  readonly haut: number;
  readonly bas: number;
  readonly cloture: number;
  readonly volume: number | null;
}

/**
 * Contrôle de cohérence d'une bougie.
 *
 * Un haut inférieur à l'ouverture n'est pas une bougie, c'est une erreur de
 * colonne — le plus souvent haut et bas inversés à l'export. La corriger en
 * silence masquerait la faute et laisserait passer les vraies inversions.
 */
function incoherence(brouillon: Brouillon): string | null {
  const { ouverture, haut, bas, cloture } = brouillon;

  for (const [nom, valeur] of Object.entries({ ouverture, haut, bas, cloture })) {
    if (!Number.isFinite(valeur)) return `${nom} illisible`;
    if (valeur <= 0) return `${nom} nul ou négatif (${valeur})`;
  }

  if (haut < bas) return `haut (${haut}) sous le bas (${bas}) : colonnes probablement inversées`;
  if (haut < Math.max(ouverture, cloture)) {
    return `haut (${haut}) sous l’ouverture ou la clôture`;
  }
  if (bas > Math.min(ouverture, cloture)) {
    return `bas (${bas}) au-dessus de l’ouverture ou la clôture`;
  }
  if (brouillon.volume !== null && brouillon.volume < 0) {
    return `volume négatif (${brouillon.volume})`;
  }
  return null;
}

/** Nombre maximal d'anomalies détaillées. Au-delà, on compte sans détailler. */
const ANOMALIES_DETAILLEES = 50;

export function analyserCsv(contenu: string): ResultatImport {
  const lignes = contenu.split(/\r?\n/).filter((ligne) => ligne.trim() !== '');
  if (lignes.length < 2) {
    return vide([{ ligne: null, message: 'Fichier vide ou sans ligne de données.' }]);
  }

  const separateur = detecterSeparateur(lignes[0]!);
  const entetes = decouper(lignes[0]!, separateur);
  const roles = new Map<string, number>();
  const colonnes: Record<string, string> = {};

  entetes.forEach((entete, index) => {
    const role = roleDeColonne(entete, new Set(roles.keys()));
    // Premier arrivé, premier servi : un export qui contient « close » et
    // « adj close » doit garder le premier, pas se faire écraser par le second.
    if (role && !roles.has(role)) {
      roles.set(role, index);
      colonnes[role] = entete.trim();
    }
  });

  const manquantes = ['horodatage', 'ouverture', 'haut', 'bas', 'cloture'].filter(
    (role) => !roles.has(role),
  );
  if (manquantes.length > 0) {
    return {
      chandeliers: [],
      anomalies: [
        {
          ligne: 1,
          message:
            `Colonnes introuvables : ${manquantes.join(', ')}. ` +
            `En-têtes lus : ${entetes.map((e) => e.trim()).join(', ')}.`,
        },
      ],
      colonnes,
      bloquant: true,
    };
  }

  const indexDate = roles.get('horodatage')!;
  const indexHeure = roles.get('heure');

  const corps = lignes.slice(1).map((ligne) => decouper(ligne, separateur));
  const jourEnPremier = ordreJourMois(corps.map((champs) => champs[indexDate] ?? ''));

  // Le séparateur décimal se décide sur les colonnes de prix, pas sur une
  // valeur isolée : une seule cotation à quatre décimales suffit à trancher
  // pour tout le fichier.
  const echantillons = corps.flatMap((champs) =>
    ['ouverture', 'haut', 'bas', 'cloture'].map((role) => champs[roles.get(role)!] ?? ''),
  );
  const decimal = separateurDecimal(echantillons);

  const brouillons: Brouillon[] = [];
  const anomalies: AnomalieImport[] = [];
  let rejets = 0;

  const signaler = (ligne: number, message: string) => {
    rejets += 1;
    if (anomalies.length < ANOMALIES_DETAILLEES) anomalies.push({ ligne, message });
  };

  corps.forEach((champs, position) => {
    const numero = position + 2; // +1 pour l'en-tête, +1 pour compter depuis 1

    const brutDate =
      indexHeure === undefined
        ? (champs[indexDate] ?? '')
        : `${champs[indexDate] ?? ''} ${champs[indexHeure] ?? ''}`.trim();

    const date = lireDate(brutDate, jourEnPremier);
    if (date.horodatage === null) {
      signaler(numero, date.refus ?? 'date illisible');
      return;
    }

    const valeur = (role: string) => lireNombre(champs[roles.get(role)!] ?? '', decimal);
    const ouverture = valeur('ouverture');
    const haut = valeur('haut');
    const bas = valeur('bas');
    const cloture = valeur('cloture');
    const volumeIndex = roles.get('volume');
    const volume =
      volumeIndex === undefined ? null : lireNombre(champs[volumeIndex] ?? '', decimal);

    if (ouverture === null || haut === null || bas === null || cloture === null) {
      signaler(numero, 'une des valeurs OHLC est vide ou illisible');
      return;
    }

    const brouillon: Brouillon = {
      ligne: numero,
      horodatage: date.horodatage,
      ouverture,
      haut,
      bas,
      cloture,
      volume,
    };
    const probleme = incoherence(brouillon);
    if (probleme) {
      signaler(numero, probleme);
      return;
    }

    brouillons.push(brouillon);
  });

  return finaliser(brouillons, anomalies, rejets, colonnes, corps.length, decimal);
}

export function analyserJson(contenu: string): ResultatImport {
  let brut: unknown;
  try {
    brut = JSON.parse(contenu);
  } catch {
    return vide([{ ligne: null, message: 'JSON illisible.' }]);
  }

  // Twelve Data enveloppe ses séries dans `values` ; d'autres sources rendent
  // le tableau directement. On accepte les deux.
  const tableau = Array.isArray(brut)
    ? brut
    : Array.isArray((brut as { values?: unknown }).values)
      ? ((brut as { values: unknown[] }).values)
      : Array.isArray((brut as { data?: unknown }).data)
        ? ((brut as { data: unknown[] }).data)
        : null;

  if (!tableau) {
    return vide([
      {
        ligne: null,
        message: 'JSON inattendu : un tableau de bougies est attendu, ou un objet { values: [...] }.',
      },
    ]);
  }
  if (tableau.length === 0) return vide([{ ligne: null, message: 'Aucune bougie dans le fichier.' }]);

  const premier = tableau[0] as Record<string, unknown>;
  const roles = new Map<string, string>();
  const colonnes: Record<string, string> = {};

  for (const cle of Object.keys(premier)) {
    const role = roleDeColonne(cle, new Set(roles.keys()));
    if (role && !roles.has(role)) {
      roles.set(role, cle);
      colonnes[role] = cle;
    }
  }

  const manquantes = ['horodatage', 'ouverture', 'haut', 'bas', 'cloture'].filter(
    (role) => !roles.has(role),
  );
  if (manquantes.length > 0) {
    return {
      chandeliers: [],
      anomalies: [
        {
          ligne: null,
          message:
            `Champs introuvables : ${manquantes.join(', ')}. ` +
            `Champs lus : ${Object.keys(premier).join(', ')}.`,
        },
      ],
      colonnes,
      bloquant: true,
    };
  }

  const cleDate = roles.get('horodatage')!;
  const jourEnPremier = ordreJourMois(
    tableau.map((entree) => String((entree as Record<string, unknown>)[cleDate] ?? '')),
  );

  // Les valeurs numériques natives du JSON n'ont aucune ambiguïté ; seules les
  // chaînes en ont. On ne fait donc porter la décision que sur celles-ci.
  const decimal = separateurDecimal(
    tableau.flatMap((entree) =>
      ['ouverture', 'haut', 'bas', 'cloture']
        .map((role) => (entree as Record<string, unknown>)[roles.get(role)!])
        .filter((valeur): valeur is string => typeof valeur === 'string'),
    ),
  );

  const brouillons: Brouillon[] = [];
  const anomalies: AnomalieImport[] = [];
  let rejets = 0;

  const signaler = (ligne: number, message: string) => {
    rejets += 1;
    if (anomalies.length < ANOMALIES_DETAILLEES) anomalies.push({ ligne, message });
  };

  tableau.forEach((entree, position) => {
    const objet = entree as Record<string, unknown>;
    const numero = position + 1;

    const date = lireDate(String(objet[cleDate] ?? ''), jourEnPremier);
    if (date.horodatage === null) {
      signaler(numero, date.refus ?? 'date illisible');
      return;
    }

    const valeur = (role: string) => {
      const cle = roles.get(role);
      if (cle === undefined) return null;
      const contenuChamp = objet[cle];
      return typeof contenuChamp === 'number'
        ? contenuChamp
        : lireNombre(String(contenuChamp ?? ''), decimal);
    };

    const ouverture = valeur('ouverture');
    const haut = valeur('haut');
    const bas = valeur('bas');
    const cloture = valeur('cloture');

    if (ouverture === null || haut === null || bas === null || cloture === null) {
      signaler(numero, 'une des valeurs OHLC est vide ou illisible');
      return;
    }

    const brouillon: Brouillon = {
      ligne: numero,
      horodatage: date.horodatage,
      ouverture,
      haut,
      bas,
      cloture,
      volume: valeur('volume'),
    };
    const probleme = incoherence(brouillon);
    if (probleme) {
      signaler(numero, probleme);
      return;
    }

    brouillons.push(brouillon);
  });

  return finaliser(brouillons, anomalies, rejets, colonnes, tableau.length, decimal);
}

export function analyserFichier(contenu: string, format: FormatFichier): ResultatImport {
  return format === 'json' ? analyserJson(contenu) : analyserCsv(contenu);
}

/** Devine le format d'après le nom de fichier, puis d'après le contenu. */
export function formatDepuisNom(nom: string, contenu: string): FormatFichier {
  if (/\.json$/i.test(nom)) return 'json';
  if (/\.(csv|txt|tsv)$/i.test(nom)) return 'csv';
  return contenu.trimStart().startsWith('{') || contenu.trimStart().startsWith('[')
    ? 'json'
    : 'csv';
}

/**
 * Tri, déduplication et verdict.
 *
 * Le tri est indispensable : certains exports vont du plus récent au plus
 * ancien, et le moteur de backtest suppose l'ordre chronologique. Les doublons
 * d'horodatage sont écartés en gardant le premier — un fichier concaténé deux
 * fois ne doit pas doubler le volume ni fausser les indicateurs.
 */
function finaliser(
  brouillons: Brouillon[],
  anomalies: AnomalieImport[],
  rejets: number,
  colonnes: Record<string, string>,
  lignesLues: number,
  decimal: SeparateurDecimal | null,
): ResultatImport {
  const tries = [...brouillons].sort((a, b) => a.horodatage - b.horodatage);

  const chandeliers: Chandelier[] = [];
  const vus = new Set<number>();
  let doublons = 0;

  for (const brouillon of tries) {
    if (vus.has(brouillon.horodatage)) {
      doublons += 1;
      continue;
    }
    vus.add(brouillon.horodatage);
    chandeliers.push({
      horodatage: brouillon.horodatage,
      ouverture: brouillon.ouverture,
      haut: brouillon.haut,
      bas: brouillon.bas,
      cloture: brouillon.cloture,
      volume: brouillon.volume,
    });
  }

  const bilan = [...anomalies];

  // Hypothèse assumée plutôt que silencieuse : aucune valeur du fichier ne
  // permettait de distinguer un décimal d'un séparateur de milliers.
  if (decimal === null && chandeliers.length > 0) {
    bilan.push({
      ligne: null,
      message:
        'Séparateur décimal indéterminable : le point a été supposé. ' +
        'Vérifier l’ordre de grandeur des prix importés.',
    });
  }

  if (rejets > anomalies.length) {
    bilan.push({
      ligne: null,
      message: `${rejets - anomalies.length} autre(s) ligne(s) rejetée(s), non détaillées.`,
    });
  }
  if (doublons > 0) {
    bilan.push({ ligne: null, message: `${doublons} doublon(s) d’horodatage écarté(s).` });
  }

  // Un fichier dont plus de la moitié des lignes est rejetée n'est pas un
  // fichier avec quelques scories : c'est un fichier mal interprété. Mieux vaut
  // ne rien écrire et laisser corriger le format.
  const bloquant = chandeliers.length === 0 || rejets > lignesLues / 2;
  if (bloquant && chandeliers.length > 0) {
    bilan.push({
      ligne: null,
      message:
        `Import bloqué : ${rejets} lignes rejetées sur ${lignesLues}. ` +
        'Au-delà de la moitié, le fichier est probablement mal interprété plutôt qu’imparfait.',
    });
  }

  return { chandeliers, anomalies: bilan, colonnes, bloquant };
}

function vide(anomalies: AnomalieImport[]): ResultatImport {
  return { chandeliers: [], anomalies, colonnes: {}, bloquant: true };
}

/**
 * Intervalle déduit de l'espacement des bougies.
 *
 * On prend la **médiane** des écarts et non la moyenne : les fins de semaine et
 * les jours fériés créent des trous énormes qui tireraient une moyenne vers le
 * haut, au point de faire passer du M5 pour de l'horaire.
 */
export function intervalleDeduit(chandeliers: readonly Chandelier[]): number | null {
  if (chandeliers.length < 3) return null;

  const ecarts: number[] = [];
  for (let index = 1; index < chandeliers.length; index += 1) {
    const ecart = chandeliers[index]!.horodatage - chandeliers[index - 1]!.horodatage;
    if (ecart > 0) ecarts.push(ecart);
  }
  if (ecarts.length === 0) return null;

  ecarts.sort((a, b) => a - b);
  return ecarts[Math.floor(ecarts.length / 2)]!;
}
