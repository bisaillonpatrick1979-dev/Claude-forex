import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { envPublic } from '@/lib/config/env';
import type { Database } from '@/types/base-de-donnees';

/** Chemins accessibles sans session. Tout le reste redirige vers /connexion. */
const CHEMINS_PUBLICS = ['/connexion', '/auth'];

function estPublic(chemin: string): boolean {
  return CHEMINS_PUBLICS.some((prefixe) => chemin.startsWith(prefixe));
}

/**
 * Rafraîchit le jeton de session et protège les routes.
 *
 * Rien ne doit s'insérer entre createServerClient et getClaims() : toute
 * opération asynchrone intercalée provoque des déconnexions aléatoires
 * difficiles à diagnostiquer.
 */
export async function rafraichirSession(requete: NextRequest): Promise<NextResponse> {
  let reponse = NextResponse.next({ request: requete });
  const env = envPublic();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return requete.cookies.getAll();
        },
        setAll(cookiesAPoser) {
          for (const { name, value } of cookiesAPoser) {
            requete.cookies.set(name, value);
          }
          reponse = NextResponse.next({ request: requete });
          for (const { name, value, options } of cookiesAPoser) {
            reponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() vérifie la signature du JWT à chaque appel ; getSession() ne
  // garantit rien côté serveur et ne doit pas servir à protéger une page.
  const { data } = await supabase.auth.getClaims();
  const chemin = requete.nextUrl.pathname;

  if (!data?.claims && !estPublic(chemin)) {
    const url = requete.nextUrl.clone();
    url.pathname = '/connexion';
    url.searchParams.set('suivant', chemin);
    return NextResponse.redirect(url);
  }

  if (data?.claims && chemin === '/connexion') {
    const url = requete.nextUrl.clone();
    url.pathname = '/salle-des-marches';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return reponse;
}
