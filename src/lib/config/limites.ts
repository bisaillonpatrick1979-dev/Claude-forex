/**
 * Définition unique des limites éditables.
 *
 * Le formulaire et l'action serveur lisent la **même** table. C'est délibéré :
 * une borne écrite deux fois finit toujours par diverger, et la divergence se
 * paie du mauvais côté — le navigateur affiche « max 50 » pendant que la base
 * refuse à 30, ou pire, le navigateur autorise ce que la base accepte et que le
 * moteur de risque ne sait pas gérer.
 *
 * Les bornes reproduisent exactement les contraintes CHECK de PostgreSQL. La
 * validation côté serveur n'est donc pas une politesse : c'est elle qui rend un
 * message lisible là où la base ne renverrait qu'un nom de contrainte.
 */

import type { Database } from '@/types/base-de-donnees';

type MajRisque = Database['public']['Tables']['parametres_risque']['Update'];
type MajProfil = Database['public']['Tables']['profils']['Update'];

export type CleLimite =
  | 'risqueMaxParTradePct'
  | 'risqueTotalMaxPct'
  | 'positionsMax'
  | 'partPositionMaxPct'
  | 'partFacteurMaxPct'
  | 'perteJournaliereMaxPct'
  | 'drawdownMaxPct'
  | 'levierMax'
  | 'fenetreEvenementMacroMinutes'
  | 'plafondCoutQuotidienUsd';

export interface ChampLimite {
  readonly cle: CleLimite;
  readonly libelle: string;
  readonly unite: string;
  readonly min: number;
  readonly max: number;
  readonly pas: number;
  /** Colonne visée : les limites de risque et le budget IA ne vivent pas
   *  dans la même table. */
  readonly table: 'parametres_risque' | 'profils';
  readonly colonne: (keyof MajRisque & string) | (keyof MajProfil & string);
  readonly aide: string;
}

export const CHAMPS_LIMITES: readonly ChampLimite[] = [
  {
    cle: 'risqueMaxParTradePct',
    libelle: 'Risque par trade',
    unite: '%',
    min: 0.01,
    max: 10,
    pas: 0.05,
    table: 'parametres_risque',
    colonne: 'risque_max_par_trade_pct',
    aide: 'Part de l’équité perdue si le stop est touché. Au-delà de 2 %, une série de cinq pertes coûte un quart du compte.',
  },
  {
    cle: 'risqueTotalMaxPct',
    libelle: 'Risque total simultané',
    unite: '%',
    min: 0.1,
    max: 50,
    pas: 0.5,
    table: 'parametres_risque',
    colonne: 'risque_total_max_pct',
    aide: 'Budget de risque agrégé, corrélations comprises. C’est lui qui borne l’exposition nette par devise.',
  },
  {
    cle: 'positionsMax',
    libelle: 'Positions simultanées',
    unite: '',
    min: 1,
    max: 50,
    pas: 1,
    table: 'parametres_risque',
    colonne: 'positions_max',
    aide: 'Compte brut, indépendant du risque porté.',
  },
  {
    cle: 'partPositionMaxPct',
    libelle: 'Part max d’une position',
    unite: '% du risque agrégé',
    min: 1,
    max: 100,
    pas: 5,
    table: 'parametres_risque',
    colonne: 'part_position_max_pct',
    aide: 'À 50 %, deux positions de même taille sont exactement à parité. Ne s’applique qu’à partir de la deuxième position.',
  },
  {
    cle: 'partFacteurMaxPct',
    libelle: 'Part max d’un facteur',
    unite: '% du budget',
    min: 1,
    max: 100,
    pas: 5,
    table: 'parametres_risque',
    colonne: 'part_facteur_max_pct',
    aide: 'Exposition nette d’une devise ou d’une classe d’actif. C’est ce plafond qui empêche trois paires distinctes de n’être qu’un seul pari short USD.',
  },
  {
    cle: 'perteJournaliereMaxPct',
    libelle: 'Perte journalière max',
    unite: '%',
    min: 0.1,
    max: 100,
    pas: 0.5,
    table: 'parametres_risque',
    colonne: 'perte_journaliere_max_pct',
    aide: 'Atteinte : agents en pause jusqu’au lendemain.',
  },
  {
    cle: 'drawdownMaxPct',
    libelle: 'Drawdown max',
    unite: '%',
    min: 0.1,
    max: 100,
    pas: 1,
    table: 'parametres_risque',
    colonne: 'drawdown_max_pct',
    aide: 'Mesuré depuis le sommet d’équité. Atteint : arrêt complet, reprise sur intervention manuelle.',
  },
  {
    cle: 'levierMax',
    libelle: 'Levier max',
    unite: ':1',
    min: 1,
    max: 30,
    pas: 1,
    table: 'parametres_risque',
    colonne: 'levier_max',
    aide: 'Plafond maison, indépendant de ce que le courtier autoriserait.',
  },
  {
    cle: 'fenetreEvenementMacroMinutes',
    libelle: 'Fenêtre macro',
    unite: 'min',
    min: 0,
    max: 240,
    pas: 5,
    table: 'parametres_risque',
    colonne: 'fenetre_evenement_macro_minutes',
    aide: 'Aucune ouverture dans cette fenêtre autour d’un événement à fort impact. Zéro désactive le contrôle.',
  },
  {
    cle: 'plafondCoutQuotidienUsd',
    libelle: 'Budget IA quotidien',
    unite: 'USD / jour',
    min: 0,
    max: 1000,
    pas: 1,
    table: 'profils',
    colonne: 'plafond_cout_quotidien_usd',
    aide: 'Dépense maximale en appels de modèles, journée UTC. Atteint : les cycles s’arrêtent net plutôt que de finir à moitié.',
  },
];

export type ValeursLimites = Readonly<Record<CleLimite, number>>;

export interface ResultatValidation {
  readonly ok: boolean;
  readonly erreurs: Readonly<Partial<Record<CleLimite, string>>>;
  /** Erreurs portant sur une combinaison de champs, pas sur un champ isolé. */
  readonly incoherences: readonly string[];
}

/**
 * Valide un jeu de limites.
 *
 * Deux niveaux, parce que deux natures d'erreur différentes. Les bornes par
 * champ reproduisent la base. Les incohérences, elles, portent sur des couples
 * de champs que la base ne peut pas vérifier — chacune produit un réglage qui
 * *paraît* actif alors qu'il ne peut jamais se déclencher, ce qui est plus
 * dangereux qu'une valeur franchement refusée.
 */
export function validerLimites(valeurs: Partial<Record<CleLimite, unknown>>): ResultatValidation {
  const erreurs: Partial<Record<CleLimite, string>> = {};
  const propres: Partial<Record<CleLimite, number>> = {};

  for (const champ of CHAMPS_LIMITES) {
    const brut = valeurs[champ.cle];
    // `Number('')` et `Number('   ')` valent zéro, pas NaN : sans ce test, un
    // champ vidé passerait pour un zéro délibéré — accepté sur la fenêtre
    // macro, qui autorise zéro, et le contrôle serait désactivé en silence.
    const vide =
      brut === undefined || brut === null || (typeof brut === 'string' && brut.trim() === '');
    const valeur = typeof brut === 'number' ? brut : Number(brut);

    if (vide || !Number.isFinite(valeur)) {
      erreurs[champ.cle] = `${champ.libelle} : valeur manquante ou non numérique.`;
      continue;
    }
    if (valeur < champ.min || valeur > champ.max) {
      erreurs[champ.cle] =
        `${champ.libelle} : attendu entre ${champ.min} et ${champ.max}${champ.unite ? ` ${champ.unite}` : ''}.`;
      continue;
    }
    propres[champ.cle] = valeur;
  }

  const incoherences: string[] = [];

  const parTrade = propres.risqueMaxParTradePct;
  const total = propres.risqueTotalMaxPct;
  if (parTrade !== undefined && total !== undefined && parTrade > total) {
    incoherences.push(
      `Le risque par trade (${parTrade} %) dépasse le risque total (${total} %) : ` +
        'le plafond par trade ne pourrait jamais être atteint, puisque le budget agrégé mordrait avant.',
    );
  }

  const journaliere = propres.perteJournaliereMaxPct;
  const drawdown = propres.drawdownMaxPct;
  if (journaliere !== undefined && drawdown !== undefined && journaliere > drawdown) {
    incoherences.push(
      `La perte journalière (${journaliere} %) dépasse le drawdown maximal (${drawdown} %) : ` +
        'le drawdown déclencherait toujours en premier, et la pause journalière ne servirait jamais.',
    );
  }

  return {
    ok: Object.keys(erreurs).length === 0 && incoherences.length === 0,
    erreurs,
    incoherences,
  };
}

/**
 * Répartit les valeurs validées par table de destination.
 *
 * Les objets sont construits par accumulation à partir de `CHAMPS_LIMITES`,
 * puis typés aux formes `Update` de la base. Le transtypage est nécessaire —
 * TypeScript ne peut pas prouver qu'une boucle remplit exactement les bonnes
 * clés — mais il reste vérifié : `colonne` est déclarée comme une clé de la
 * table visée, donc une faute de frappe est refusée à la compilation.
 */
export function repartirParTable(valeurs: ValeursLimites): {
  parametresRisque: MajRisque;
  profils: MajProfil;
} {
  const parametresRisque: Record<string, number> = {};
  const profils: Record<string, number> = {};

  for (const champ of CHAMPS_LIMITES) {
    const cible = champ.table === 'profils' ? profils : parametresRisque;
    cible[champ.colonne] = valeurs[champ.cle];
  }

  return { parametresRisque: parametresRisque as MajRisque, profils: profils as MajProfil };
}
