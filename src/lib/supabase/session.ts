import { clientServeur } from './serveur';

/**
 * Identifiant du profil authentifié, ou `null`.
 *
 * Passe systématiquement par getClaims() : la signature du JWT est vérifiée à
 * chaque appel. Aucune route ne doit déduire l'identité d'un paramètre ou d'un
 * en-tête fourni par le client.
 */
export async function profilAuthentifie(): Promise<string | null> {
  const supabase = await clientServeur();
  const { data } = await supabase.auth.getClaims();
  const sujet = data?.claims?.sub;
  return typeof sujet === 'string' ? sujet : null;
}
