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

/**
 * Noms de variables d'environnement reconnus par service.
 *
 * Le chiffrement en base est la voie recommandée, mais il exige
 * `CLE_CHIFFREMENT` côté serveur. Tant qu'elle manque, l'écran refuse
 * d'enregistrer quoi que ce soit — à juste titre : stocker une clé en clair
 * serait pire. Le résultat est cependant une impasse pour qui n'a pas de
 * terminal sous la main pour générer trente-deux octets aléatoires.
 *
 * Poser la clé dans les variables d'environnement de l'hébergeur lève
 * l'impasse : la valeur ne transite jamais par notre base, donc la question du
 * chiffrement au repos ne se pose pas — c'est l'hébergeur qui la protège.
 *
 * Mêmes conventions de nommage que pour les modèles de langage, et même ordre
 * de priorité : la base d'abord, l'environnement en repli. Une clé saisie dans
 * l'application est un choix explicite ; elle doit primer sur une variable
 * posée une fois puis oubliée.
 */
const VARIABLES_PAR_SERVICE: Readonly<Record<string, readonly string[]>> = {
  twelvedata: ['TWELVEDATA_API_KEY', 'CLE_API_TWELVEDATA'],
  finnhub: ['FINNHUB_API_KEY', 'CLE_API_FINNHUB'],
  alphavantage: ['ALPHAVANTAGE_API_KEY', 'CLE_API_ALPHAVANTAGE'],
  alpaca: ['ALPACA_API_KEY', 'CLE_API_ALPACA'],
};

export function variablesReconnuesFournisseur(service: string): readonly string[] {
  return VARIABLES_PAR_SERVICE[service] ?? [];
}

export function cleFournisseurDepuisEnvironnement(service: string): string | null {
  for (const nom of variablesReconnuesFournisseur(service)) {
    const valeur = process.env[nom]?.trim();
    if (valeur) return valeur;
  }
  return null;
}

/**
 * Variante tolérante à l'absence de client à privilèges.
 *
 * `clientAdminOptionnel()` rend `null` quand SUPABASE_SERVICE_ROLE_KEY manque.
 * Les appelants écrivaient alors `client ? await lireCle(...) : undefined`, ce
 * qui court-circuitait aussi le repli sur l'environnement — une clé posée dans
 * les variables de l'hébergeur restait invisible, et le test annonçait
 * « aucune clé enregistrée » alors qu'il y en avait une.
 *
 * La lecture en base est facultative, le repli ne l'est pas.
 */
export async function lireCleTolerante(
  client: Client | null,
  profilId: string,
  service: string,
): Promise<string | null> {
  if (client) {
    const enBase = await lireCle(client, profilId, service);
    if (enBase) return enBase;
  }
  return cleFournisseurDepuisEnvironnement(service);
}

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

  if (data) {
    try {
      return dechiffrer(data.valeur_chiffree);
    } catch {
      // Clé illisible (CLE_CHIFFREMENT changée, valeur corrompue) : on tombe
      // sur l'environnement plutôt que de propager une exception au routeur,
      // qui basculerait sur le fournisseur suivant sans dire pourquoi.
    }
  }

  return cleFournisseurDepuisEnvironnement(service);
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
