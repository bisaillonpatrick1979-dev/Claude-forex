import type { SupabaseClient } from '@supabase/supabase-js';

import { lireCle } from '@/lib/marche/cles';
import type { Database } from '@/types/base-de-donnees';

import { adaptateur } from './index';
import { coutUsd } from './tarifs';
import {
  ErreurLLM,
  type ContexteDeterministe,
  type DemandeLLM,
  type FournisseurLLM,
  type MessageLLM,
  type ReponseLLM,
} from './types';

type Client = SupabaseClient<Database>;

/**
 * Point de passage unique de tout appel à un modèle.
 *
 * Trois choses y sont faites qu'aucun appelant ne doit pouvoir oublier :
 * déchiffrer la clé au dernier moment, mesurer le coût, et écrire la ligne
 * dans `appels_llm` — y compris quand l'appel échoue. Un échec facturé mais
 * non journalisé rendrait le plafond quotidien faux.
 */

export interface ConfigurationAgent {
  readonly id: string | null;
  readonly fournisseur: FournisseurLLM;
  readonly modele: string;
  readonly temperature: number;
  readonly tokensMax: number;
}

export interface ParametresAppel {
  readonly client: Client;
  readonly profilId: string;
  readonly cycleId?: string | null;
  readonly agent: ConfigurationAgent;
  readonly systeme: string;
  readonly messages: readonly MessageLLM[];
  readonly formatJson?: string | null;
  readonly contexteDeterministe?: ContexteDeterministe | null;
  readonly rechercheWeb?: boolean;
  readonly domainesAutorises?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ResultatAppel extends ReponseLLM {
  /** `null` quand le modèle n'est pas dans la grille tarifaire : afficher
   *  « coût inconnu » vaut mieux qu'afficher 0,00 $. */
  readonly coutUsd: number | null;
}

/**
 * Clés lisibles dans l'environnement du serveur.
 *
 * La voie normale est la clé chiffrée en base, saisie dans l'onglet « Clés IA ».
 * Mais poser sa clé dans les variables d'environnement de l'hébergeur est un
 * réflexe si répandu qu'ignorer ce cas produit exactement le symptôme
 * rencontré : la clé est bien là, l'application ne la voit pas, et rien
 * n'explique pourquoi.
 *
 * Ordre volontaire : la base d'abord. Une clé saisie dans l'application est un
 * choix explicite de l'utilisateur ; elle doit primer sur une variable posée
 * une fois puis oubliée.
 *
 * Les noms suivent la convention de chaque fournisseur, pas une convention
 * maison : c'est ce que les gens ont déjà tapé.
 */
const VARIABLES_PAR_FOURNISSEUR: Readonly<Record<FournisseurLLM, readonly string[]>> = {
  anthropic: ['ANTHROPIC_API_KEY', 'CLE_API_ANTHROPIC'],
  openai: ['OPENAI_API_KEY', 'CLE_API_OPENAI'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'CLE_API_GOOGLE'],
  deepseek: ['DEEPSEEK_API_KEY', 'CLE_API_DEEPSEEK'],
  mistral: ['MISTRAL_API_KEY', 'CLE_API_MISTRAL'],
  mock: [],
};

export function cleDepuisEnvironnement(fournisseur: FournisseurLLM): string | undefined {
  for (const nom of VARIABLES_PAR_FOURNISSEUR[fournisseur]) {
    const valeur = process.env[nom]?.trim();
    if (valeur) return valeur;
  }
  return undefined;
}

/** Noms des variables reconnues, pour les afficher dans les réglages. */
export function variablesReconnues(fournisseur: FournisseurLLM): readonly string[] {
  return VARIABLES_PAR_FOURNISSEUR[fournisseur];
}

export async function appelerModele(parametres: ParametresAppel): Promise<ResultatAppel> {
  const { client, profilId, agent } = parametres;
  const implementation = adaptateur(agent.fournisseur);

  const cle = implementation.necessiteCle
    ? ((await lireCle(client, profilId, agent.fournisseur)) ??
      cleDepuisEnvironnement(agent.fournisseur))
    : undefined;

  if (implementation.necessiteCle && !cle) {
    const erreur = new ErreurLLM(
      agent.fournisseur,
      `Aucune clé ${implementation.nom} : ni dans l'onglet « Clés IA », ni dans ${variablesReconnues(agent.fournisseur).join(' ou ')}.`,
    );
    await journaliser(parametres, null, erreur.message);
    throw erreur;
  }

  const demande: DemandeLLM = {
    modele: agent.modele,
    systeme: parametres.systeme,
    messages: parametres.messages,
    tokensMax: agent.tokensMax,
    // Le champ vaut `null` quand la température ne doit pas partir du tout ;
    // chaque adaptateur applique ensuite ses propres contraintes de modèle.
    temperature: Number.isFinite(agent.temperature) ? agent.temperature : null,
    formatJson: parametres.formatJson ?? null,
    contexteDeterministe: parametres.contexteDeterministe ?? null,
    rechercheWeb: parametres.rechercheWeb ?? false,
    domainesAutorises: parametres.domainesAutorises,
    signal: parametres.signal,
  };

  try {
    const reponse = await implementation.appeler(demande, { cle });
    const cout = coutUsd(reponse.modele, reponse.tokensEntree, reponse.tokensSortie);
    await journaliser(parametres, { reponse, cout }, null);
    return { ...reponse, coutUsd: cout };
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : 'Erreur inconnue.';
    await journaliser(parametres, null, message);
    throw erreur instanceof ErreurLLM ? erreur : new ErreurLLM(agent.fournisseur, message);
  }
}

async function journaliser(
  parametres: ParametresAppel,
  succes: { reponse: ReponseLLM; cout: number | null } | null,
  erreur: string | null,
): Promise<void> {
  const { client, profilId, cycleId, agent } = parametres;

  await client.from('appels_llm').insert({
    profil_id: profilId,
    agent_id: agent.id,
    cycle_id: cycleId ?? null,
    fournisseur: agent.fournisseur,
    modele: succes?.reponse.modele ?? agent.modele,
    tokens_entree: succes?.reponse.tokensEntree ?? 0,
    tokens_sortie: succes?.reponse.tokensSortie ?? 0,
    // Un modèle hors grille est compté zéro faute de mieux ; l'écran des coûts
    // signale ces lignes pour que le total ne soit pas pris pour exact.
    cout_usd: succes?.cout ?? 0,
    latence_ms: succes?.reponse.latenceMs ?? null,
    succes: succes !== null,
    erreur: erreur ? erreur.slice(0, 500) : null,
  });
}
