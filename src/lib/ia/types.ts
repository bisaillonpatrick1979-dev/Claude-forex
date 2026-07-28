import type { Database } from '@/types/base-de-donnees';

/**
 * Contrat unique des fournisseurs de modèles de langage.
 *
 * Même logique que la couche marché : aucun étage de l'application ne parle
 * directement à Anthropic, OpenAI ou Google. Tout passe par un adaptateur, ce
 * qui permet de changer de fournisseur agent par agent sans toucher à
 * l'orchestration, et de faire tourner un cycle complet sur `mock` — donc
 * gratuitement — avant de dépenser un dollar.
 */

export type FournisseurLLM = Database['public']['Enums']['fournisseur_llm'];

export type RoleMessage = 'utilisateur' | 'assistant';

export const NIVEAUX_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type NiveauEffort = (typeof NIVEAUX_EFFORT)[number];

export function estNiveauEffort(valeur: string): valeur is NiveauEffort {
  return (NIVEAUX_EFFORT as readonly string[]).includes(valeur);
}

export interface MessageLLM {
  readonly role: RoleMessage;
  readonly contenu: string;
}

/**
 * Données brutes que l'adaptateur `mock` utilise pour produire une sortie
 * cohérente avec l'instantané de marché, sans réseau ni coût. Les adaptateurs
 * réels l'ignorent : leurs prix viennent du texte du prompt, comme il se doit.
 */
export interface ContexteDeterministe {
  readonly symbole: string;
  readonly dernierPrix: number;
  readonly atr: number | null;
  readonly decimales: number;
}

export interface DemandeLLM {
  readonly modele: string;
  readonly systeme: string;
  readonly messages: readonly MessageLLM[];
  readonly tokensMax: number;
  /**
   * `null` = ne pas transmettre du tout. Indispensable : Opus 5, Sonnet 5 et
   * Opus 4.7+ répondent 400 quand `temperature` est présent.
   */
  readonly temperature: number | null;
  /**
   * Profondeur de réflexion demandée. `null` = ne rien transmettre.
   *
   * C'est le levier de coût et de latence des modèles récents, et il n'a rien
   * d'équivalent à la température : celle-ci fait varier le style, celui-ci
   * fait varier la quantité de raisonnement. Les fournisseurs qui ne le
   * connaissent pas l'ignorent.
   */
  readonly effort?: NiveauEffort | null;
  /** Nom du format JSON attendu, injecté dans le prompt et lu par `mock`. */
  readonly formatJson?: string | null;
  /**
   * Autorise l'agent à chercher sur le web et à lire des pages.
   *
   * Réservé aux rôles dont le travail est hors du graphique — macro, nouvelles,
   * fondamental. Le donner à l'analyste technique n'apporterait rien : ses
   * données sont déjà dans l'instantané, et chaque recherche coûte des tokens.
   *
   * Tous les fournisseurs ne savent pas le faire. Ceux qui ne savent pas
   * l'ignorent et répondent sans, ce qui reste préférable à un échec.
   */
  readonly rechercheWeb?: boolean;
  /** Domaines auxquels la recherche est restreinte. Vide = aucune restriction. */
  readonly domainesAutorises?: readonly string[];
  readonly contexteDeterministe?: ContexteDeterministe | null;
  readonly signal?: AbortSignal;
  /**
   * Appelée à chaque morceau de texte produit, pendant la génération.
   *
   * Absente, l'adaptateur fait un appel classique et rend la réponse d'un
   * bloc — c'est le comportement d'origine et il reste valable. Présente, les
   * adaptateurs qui savent diffuser le font ; ceux qui ne savent pas
   * l'ignorent et rendent quand même une réponse complète. Aucun appelant ne
   * dépend donc du streaming pour obtenir un résultat : il ne change que la
   * façon dont le texte arrive.
   */
  readonly surFragment?: (fragment: string) => void;
}

export interface ReponseLLM {
  readonly contenu: string;
  /** Sources réellement consultées, pour que l'utilisateur puisse vérifier. */
  readonly sources?: readonly { readonly titre: string; readonly url: string }[];
  readonly tokensEntree: number;
  readonly tokensSortie: number;
  readonly latenceMs: number;
  readonly modele: string;
  /** Vrai si le modèle s'est arrêté sur la limite de tokens, pas de lui-même. */
  readonly tronquee: boolean;
}

export interface ContexteAppelLLM {
  /** Clé API en clair, déchiffrée juste avant l'appel. Absente pour `mock`. */
  readonly cle?: string;
}

export interface AdaptateurLLM {
  readonly code: FournisseurLLM;
  readonly nom: string;
  readonly necessiteCle: boolean;
  /** Modèles proposés dans l'interface. La liste n'est pas exhaustive côté
   *  fournisseur : c'est ce que cette application sait tarifer. */
  readonly modeles: readonly string[];
  appeler(demande: DemandeLLM, contexte: ContexteAppelLLM): Promise<ReponseLLM>;
}

/** Erreur normalisée : l'orchestrateur ne doit pas connaître les codes HTTP
 *  ni les hiérarchies d'exceptions propres à chaque SDK. */
export class ErreurLLM extends Error {
  readonly fournisseur: FournisseurLLM;
  /** Vrai pour un 429 ou un 5xx : réessayer a un sens. */
  readonly recuperable: boolean;

  constructor(fournisseur: FournisseurLLM, message: string, recuperable = false) {
    super(message);
    this.name = 'ErreurLLM';
    this.fournisseur = fournisseur;
    this.recuperable = recuperable;
  }
}

/** Estimation grossière quand un fournisseur ne renvoie pas ses compteurs.
 *  Marquée comme telle : sert à borner un budget, pas à facturer. */
export function estimerTokens(texte: string): number {
  return Math.ceil(texte.length / 4);
}
