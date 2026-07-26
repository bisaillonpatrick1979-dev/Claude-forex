import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { envPublic } from '@/lib/config/env';
import type { Database } from '@/types/base-de-donnees';

/**
 * Client serveur lié à la session de l'utilisateur : soumis à RLS, donc il ne
 * voit que les données du profil connecté. C'est le client par défaut de tous
 * les composants serveur.
 *
 * Un nouveau client par requête, jamais de variable globale : sur Vercel avec
 * Fluid Compute, une instance partagée mélangerait les sessions.
 */
export async function clientServeur() {
  const magasinCookies = await cookies();
  const env = envPublic();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return magasinCookies.getAll();
        },
        setAll(cookiesAPoser) {
          try {
            for (const { name, value, options } of cookiesAPoser) {
              magasinCookies.set(name, value, options);
            }
          } catch {
            // Appelé depuis un composant serveur : l'écriture de cookies y est
            // interdite. Le middleware rafraîchit déjà la session, donc c'est
            // sans conséquence.
          }
        },
      },
    },
  );
}
