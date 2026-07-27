import type { Database } from '@/types/base-de-donnees';

export type Intervalle = Database['public']['Enums']['intervalle'];
export type ClasseActif = Database['public']['Enums']['classe_actif'];

/** Codes des adaptateurs. Doit rester aligné sur fournisseurs_donnees.code. */
export const CODES_FOURNISSEURS = [
  'mock',
  'twelvedata',
  'yahoo',
  'finnhub',
  'alphavantage',
  'alpaca',
] as const;

export type CodeFournisseur = (typeof CODES_FOURNISSEURS)[number];

export function estCodeFournisseur(valeur: string): valeur is CodeFournisseur {
  return (CODES_FOURNISSEURS as readonly string[]).includes(valeur);
}

/**
 * Nature d'une série : inventée ou observée.
 *
 * La distinction n'est pas cosmétique. Deux fournisseurs réels qui divergent
 * sur un même instrument se querellent de quelques points ; une série simulée
 * et une série réelle n'ont aucun rapport de niveau. Recoller les deux fabrique
 * un écart qui n'a jamais existé, et tout ce qui se calcule ensuite — moyennes,
 * ATR, amplitudes, niveaux d'invalidation — hérite du mensonge.
 *
 * D'où une règle appliquée à la lecture du cache : on ne mélange jamais les
 * deux natures dans une même série.
 */
export type NatureSerie = 'SIMULE' | 'REEL';

export function natureFournisseur(code: CodeFournisseur): NatureSerie {
  return code === 'mock' ? 'SIMULE' : 'REEL';
}

/**
 * Format normalisé unique. Tous les adaptateurs sortent exactement ceci,
 * quelles que soient les excentricités de leur API d'origine.
 *
 * - horodatage : secondes UTC depuis l'époque, ouverture de la bougie ;
 * - OHLC : nombres, jamais de chaînes ;
 * - volume : nullable, parce que beaucoup de flux Forex n'en ont pas — et
 *   `null` veut dire « pas de volume », pas « volume nul ».
 */
export interface Chandelier {
  readonly horodatage: number;
  readonly ouverture: number;
  readonly haut: number;
  readonly bas: number;
  readonly cloture: number;
  readonly volume: number | null;
}

export interface DemandeChandeliers {
  /** Code interne (EURUSD, NAS100…), jamais le symbole d'un fournisseur. */
  readonly symbole: string;
  readonly classeActif: ClasseActif;
  readonly intervalle: Intervalle;
  readonly limite: number;
  /**
   * Ne rendre que des bougies strictement antérieures à cet instant (secondes
   * UTC). C'est ce qui permet de remonter le temps par tranches : sans cela un
   * fournisseur ne sait servir que sa fenêtre la plus récente, et quinze ans
   * d'historique sont hors de portée quel que soit le nombre d'appels.
   *
   * Un adaptateur qui déclare `fenetreHistorique: false` l'ignore — d'où le
   * drapeau, pour que l'importateur refuse d'entrer dans une boucle qui ne
   * progresserait jamais.
   */
  readonly avant?: number;
}

/** Ce qu'un adaptateur sait faire. Le routeur s'en sert pour ne pas appeler
 *  un fournisseur qui échouerait de toute façon. */
export interface Capacites {
  readonly classesActifs: readonly ClasseActif[];
  readonly intervalles: readonly Intervalle[];
  readonly necessiteCle: boolean;
  /** Nombre maximal de bougies rendues en un appel. */
  readonly limiteParAppel: number;
  /** Vrai si l'adaptateur honore `avant` et sait donc remonter le temps. */
  readonly fenetreHistorique: boolean;
}

export interface ContexteAppel {
  /** Clé API en clair, déchiffrée juste avant l'appel. Absente pour mock. */
  readonly cle?: string;
  /** Symbole tel que le fournisseur l'attend (EUR/USD, EURUSD=X, …). */
  readonly symboleExterne: string;
  readonly signal?: AbortSignal;
}

export interface ReponseFournisseur {
  readonly chandeliers: readonly Chandelier[];
  /** Vrai si le fournisseur annonce lui-même des données retardées. */
  readonly retarde: boolean;
}

export interface ResultatTest {
  readonly ok: boolean;
  readonly message: string;
  readonly latenceMs: number;
}

/**
 * Interface unique. Aucun agent ni composant d'interface ne parle jamais
 * directement à une API externe : tout passe par un adaptateur, puis par le
 * routeur.
 */
export interface FournisseurDonneesMarche {
  readonly code: CodeFournisseur;
  readonly nom: string;
  capacites(): Capacites;
  recupererChandeliers(
    demande: DemandeChandeliers,
    contexte: ContexteAppel,
  ): Promise<ReponseFournisseur>;
  tester(contexte: Pick<ContexteAppel, 'cle' | 'signal'>): Promise<ResultatTest>;
}

/** D'où viennent les bougies rendues — jamais caché à l'appelant ni à l'UI. */
export type OrigineDonnees = 'FOURNISSEUR' | 'CACHE' | 'CACHE_PERIME';

export interface ResultatMarche {
  readonly chandeliers: readonly Chandelier[];
  readonly origine: OrigineDonnees;
  readonly fournisseur: CodeFournisseur;
  /** Vrai quand les données servies sont hors TTL : l'UI doit le montrer. */
  readonly perime: boolean;
  readonly retarde: boolean;
  /** Tentatives échouées, dans l'ordre. Affiché en clair, jamais avalé. */
  readonly incidents: readonly IncidentFournisseur[];
  readonly recupereLe: number;
}

export interface IncidentFournisseur {
  readonly fournisseur: CodeFournisseur;
  readonly raison: string;
}
