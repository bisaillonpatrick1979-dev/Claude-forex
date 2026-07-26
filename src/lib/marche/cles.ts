import type { SupabaseClient } from '@supabase/supabase-js';

import { chiffrer, dechiffrer, indiceVisuel } from '@/lib/securite/chiffrement';
import type { Database } from '@/types/base-de-donnees';

type Client = SupabaseClient<Database>;

/**
 * Accès aux clés API chiffrées.
 *
 * Toutes ces fonctions exigent un client à privilèges : la table cles_api n'a
 * aucune policy RLS, donc elle est invisible depuis le navigateur. Le
 * déchiffrement n'a lieu qu'ici, côté serveur, juste avant l'appel sortant, et
 * la valeur en clair n'est jamais renvoyée à un composant.
 */

export async function lireCle(
  client: Client,
  profilId: string,
  service: string,
): Promise<string | null> {
  const { data } = await client
    .from('cles_api')
    .select('valeur_chiffree')
    .eq('profil_id', profilId)
    .eq('service', service)
    .maybeSingle();

  if (!data) return null;

  try {
    return dechiffrer(data.valeur_chiffree);
  } catch {
    // Clé illisible (CLE_CHIFFREMENT changée, valeur corrompue) : on traite
    // comme absente plutôt que de propager une exception au routeur, qui
    // basculera proprement sur le fournisseur suivant.
    return null;
  }
}

export async function enregistrerCle(
  client: Client,
  profilId: string,
  service: string,
  valeurClaire: string,
): Promise<void> {
  await client.from('cles_api').upsert(
    {
      profil_id: profilId,
      service,
      valeur_chiffree: chiffrer(valeurClaire),
      indice_visuel: indiceVisuel(valeurClaire),
    },
    { onConflict: 'profil_id,service' },
  );

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'ENREGISTREMENT_CLE_API',
    entite: 'cles_api',
    entite_id: service,
  });
}

export async function supprimerCle(
  client: Client,
  profilId: string,
  service: string,
): Promise<void> {
  await client.from('cles_api').delete().eq('profil_id', profilId).eq('service', service);

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'SUPPRESSION_CLE_API',
    entite: 'cles_api',
    entite_id: service,
  });
}

/** Métadonnées affichables : jamais la valeur, seulement l'indice visuel. */
export async function listerClesPubliques(
  client: Client,
  profilId: string,
): Promise<readonly { service: string; indiceVisuel: string | null; majLe: string }[]> {
  const { data } = await client
    .from('cles_api')
    .select('service, indice_visuel, maj_le')
    .eq('profil_id', profilId);

  return (data ?? []).map((ligne) => ({
    service: ligne.service,
    indiceVisuel: ligne.indice_visuel,
    majLe: ligne.maj_le,
  }));
}
