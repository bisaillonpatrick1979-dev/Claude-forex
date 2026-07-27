import type { SupabaseClient } from '@supabase/supabase-js';

import type { ResultatAppel } from '@/lib/ia/appel';
import type { FournisseurLLM } from '@/lib/ia/types';
import type { Database } from '@/types/base-de-donnees';

type Client = SupabaseClient<Database>;
type EtatCycle = Database['public']['Enums']['etat_cycle'];
type RoleAgent = Database['public']['Enums']['role_agent'];

/**
 * Écriture du fil des spécialistes.
 *
 * Chaque prise de parole est écrite en deux temps : une ligne `en_cours` avant
 * l'appel, complétée après. C'est ce qui donne à l'interface, via Realtime, un
 * fil qui se remplit au fur et à mesure au lieu d'apparaître d'un bloc à la
 * fin — et c'est aussi une trace exploitable quand un appel n'aboutit jamais.
 */

export interface AgentCharge {
  readonly id: string;
  readonly cle: string;
  readonly nom: string;
  readonly role: RoleAgent;
  readonly couleur: string;
  readonly fournisseur: FournisseurLLM;
  readonly modele: string;
  readonly temperature: number;
  readonly tokensMax: number;
  readonly mandat: string;
  readonly familleStrategie: string | null;
}

export async function chargerAgents(
  client: Client,
  profilId: string,
): Promise<readonly AgentCharge[]> {
  const { data } = await client
    .from('agents')
    .select(
      'id, cle, nom, role, couleur, fournisseur_llm, modele, temperature, tokens_max, famille_strategie, actif, mandats_agents(contenu, version, actif)',
    )
    .eq('profil_id', profilId)
    .eq('actif', true)
    .order('ordre_affichage');

  return (data ?? []).map((ligne) => {
    const mandats = (ligne.mandats_agents ?? []).filter((mandat) => mandat.actif);
    const dernier = mandats.sort((a, b) => b.version - a.version)[0];

    return {
      id: ligne.id,
      cle: ligne.cle,
      nom: ligne.nom,
      role: ligne.role,
      couleur: ligne.couleur,
      fournisseur: ligne.fournisseur_llm,
      modele: ligne.modele,
      temperature: Number(ligne.temperature),
      tokensMax: ligne.tokens_max,
      mandat: dernier?.contenu ?? `Tu es ${ligne.nom} dans une firme de trading.`,
      familleStrategie: ligne.famille_strategie,
    };
  });
}

export interface EnteteMessage {
  readonly client: Client;
  readonly profilId: string;
  readonly cycleId: string;
  readonly agentId: string | null;
  readonly etat: EtatCycle;
  readonly sequence: number;
  readonly tour: number;
}

/** Insère la ligne « en cours » et rend son identifiant. */
export async function ouvrirMessage(entete: EnteteMessage): Promise<string | null> {
  const { data } = await entete.client
    .from('messages_agents')
    .insert({
      profil_id: entete.profilId,
      cycle_id: entete.cycleId,
      agent_id: entete.agentId,
      etat: entete.etat,
      sequence: entete.sequence,
      tour: entete.tour,
      contenu: '',
      en_cours: true,
    })
    .select('id')
    .maybeSingle();

  return data?.id ?? null;
}

export async function completerMessage(
  client: Client,
  messageId: string | null,
  contenu: string,
  appel: ResultatAppel | null,
  metadonnees: Record<string, unknown> = {},
): Promise<void> {
  if (!messageId) return;

  await client
    .from('messages_agents')
    .update({
      contenu,
      resume: contenu.slice(0, 300),
      en_cours: false,
      tokens_entree: appel?.tokensEntree ?? null,
      tokens_sortie: appel?.tokensSortie ?? null,
      cout_usd: appel?.coutUsd ?? null,
      latence_ms: appel?.latenceMs ?? null,
      metadonnees: metadonnees as never,
    })
    .eq('id', messageId);
}

/** Message de la firme elle-même (collecte de données, verdict du moteur de
 *  risque, exécution) : pas d'agent, donc pas de coût. */
export async function messageSysteme(
  entete: Omit<EnteteMessage, 'agentId'>,
  contenu: string,
  metadonnees: Record<string, unknown> = {},
): Promise<void> {
  await entete.client.from('messages_agents').insert({
    profil_id: entete.profilId,
    cycle_id: entete.cycleId,
    agent_id: null,
    etat: entete.etat,
    sequence: entete.sequence,
    tour: entete.tour,
    contenu,
    resume: contenu.slice(0, 300),
    en_cours: false,
    metadonnees: metadonnees as never,
  });
}

export async function majEtatCycle(
  client: Client,
  cycleId: string,
  etat: EtatCycle,
  champs: Partial<Database['public']['Tables']['cycles']['Update']> = {},
): Promise<void> {
  await client.from('cycles').update({ etat, ...champs }).eq('id', cycleId);
}
