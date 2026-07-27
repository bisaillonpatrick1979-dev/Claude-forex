import type { FournisseurLLM } from './types';

/**
 * Tarifs publics en dollars US par million de tokens.
 *
 * Ces chiffres servent à mesurer une dépense déjà engagée et à couper avant
 * le plafond quotidien. Ils ne sont pas une facture : le fournisseur reste
 * seul juge du montant réel. Un modèle absent de cette table est utilisable,
 * mais son coût est alors inconnu — l'interface le dit au lieu d'afficher 0
 * comme si l'appel était gratuit.
 *
 * Source Anthropic : tarification publique au 2026-06-24. Sonnet 5 est en
 * tarif d'introduction (2 $ / 10 $) jusqu'au 2026-08-31 ; on retient le tarif
 * plein, ce qui surestime la dépense — une surestimation coupe trop tôt, une
 * sous-estimation dépasse le plafond.
 */

export interface Tarif {
  readonly entree: number;
  readonly sortie: number;
}

export const TARIFS: Readonly<Record<string, Tarif>> = {
  // Anthropic
  'claude-opus-5': { entree: 5, sortie: 25 },
  'claude-sonnet-5': { entree: 3, sortie: 15 },
  'claude-haiku-4-5': { entree: 1, sortie: 5 },
  // OpenAI
  'gpt-5.1': { entree: 1.25, sortie: 10 },
  'gpt-5.1-mini': { entree: 0.25, sortie: 2 },
  'gpt-4.1-mini': { entree: 0.4, sortie: 1.6 },
  'text-embedding-3-small': { entree: 0.02, sortie: 0 },
  // Google
  'gemini-2.5-pro': { entree: 1.25, sortie: 10 },
  'gemini-2.5-flash': { entree: 0.3, sortie: 2.5 },
  // DeepSeek
  'deepseek-chat': { entree: 0.27, sortie: 1.1 },
  'deepseek-reasoner': { entree: 0.55, sortie: 2.19 },
  // Mistral
  'mistral-large-latest': { entree: 2, sortie: 6 },
  'mistral-small-latest': { entree: 0.2, sortie: 0.6 },
  // Interne
  'mock-1': { entree: 0, sortie: 0 },
};

export function tarif(modele: string): Tarif | null {
  return TARIFS[modele] ?? null;
}

/** Coût estimé, ou `null` si le modèle n'est pas tarifé ici. */
export function coutUsd(
  modele: string,
  tokensEntree: number,
  tokensSortie: number,
): number | null {
  const grille = tarif(modele);
  if (!grille) return null;
  return (tokensEntree * grille.entree + tokensSortie * grille.sortie) / 1_000_000;
}

/** Modèles proposés dans l'interface, par fournisseur. */
export const MODELES_PAR_FOURNISSEUR: Readonly<Record<FournisseurLLM, readonly string[]>> = {
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5.1', 'gpt-5.1-mini', 'gpt-4.1-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  mock: ['mock-1'],
};

/**
 * Les modèles Anthropic récents rejettent `temperature` avec un 400 — ce n'est
 * pas un avertissement, l'appel échoue. La colonne `agents.temperature` existe
 * quand même parce qu'OpenAI et Google l'acceptent ; c'est ici qu'on décide de
 * la transmettre ou non. Liste blanche plutôt que liste noire : un modèle
 * inconnu ne reçoit pas de température, ce qui échoue moins fort que l'inverse.
 */
const ANTHROPIC_ACCEPTE_TEMPERATURE: readonly string[] = ['claude-haiku-4-5'];

export function accepteTemperature(fournisseur: FournisseurLLM, modele: string): boolean {
  if (fournisseur === 'anthropic') return ANTHROPIC_ACCEPTE_TEMPERATURE.includes(modele);
  return true;
}
