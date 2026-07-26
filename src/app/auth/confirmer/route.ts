import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Cible du lien de confirmation envoyé par courriel. Le jeton est échangé
 * contre une session côté serveur : il ne transite jamais par du JavaScript
 * client, et il n'est pas conservé dans l'URL après la redirection.
 */
export async function GET(requete: NextRequest) {
  const parametres = requete.nextUrl.searchParams;
  const tokenHash = parametres.get('token_hash');
  const type = parametres.get('type') as EmailOtpType | null;

  if (!tokenHash || !type) {
    redirect('/connexion?erreur=lien_invalide');
  }

  const supabase = await clientServeur();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    redirect('/connexion?erreur=lien_expire');
  }

  redirect('/salle-des-marches');
}
