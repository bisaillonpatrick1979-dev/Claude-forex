import type { NextRequest } from 'next/server';

import { rafraichirSession } from '@/lib/supabase/middleware';

export async function middleware(requete: NextRequest) {
  return rafraichirSession(requete);
}

export const config = {
  // On évite le middleware sur les fichiers statiques : chaque exécution coûte
  // une vérification de jeton, inutile pour une image.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
