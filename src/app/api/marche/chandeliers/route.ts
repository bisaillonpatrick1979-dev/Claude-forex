import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { ErreurDonneesIndisponibles } from '@/lib/marche/erreurs';
import { estIntervalle } from '@/lib/marche/intervalles';
import { obtenirChandeliers } from '@/lib/marche/routeur';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdmin } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Point d'entrée unique de l'UI pour les chandeliers.
 *
 * Le navigateur ne parle jamais à un fournisseur : il parle à cette route, qui
 * détient les clés, applique les quotas et gère la cascade de repli. La réponse
 * dit toujours d'où viennent les données et si elles sont périmées.
 */

const schemaRequete = z.object({
  symbole: z.string().min(1).max(20),
  intervalle: z.string().refine(estIntervalle, 'Intervalle inconnu.'),
  limite: z.coerce.number().int().min(1).max(1000).default(300),
  rafraichir: z.enum(['0', '1']).optional(),
});

export async function GET(requete: NextRequest) {
  const profilId = await profilAuthentifie();
  if (!profilId) {
    return NextResponse.json({ erreur: 'Authentification requise.' }, { status: 401 });
  }

  // 60 requêtes/minute et par profil : largement au-dessus d'un usage normal
  // de l'interface, assez bas pour arrêter une boucle de rendu accidentelle.
  const limitation = limiterDebit(`chandeliers:${profilId}`, 60, 60_000);
  if (!limitation.autorise) {
    return NextResponse.json(
      { erreur: 'Trop de requêtes.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(limitation.reessayerDansMs / 1000)) },
      },
    );
  }

  const analyse = schemaRequete.safeParse({
    symbole: requete.nextUrl.searchParams.get('symbole'),
    intervalle: requete.nextUrl.searchParams.get('intervalle'),
    limite: requete.nextUrl.searchParams.get('limite') ?? undefined,
    rafraichir: requete.nextUrl.searchParams.get('rafraichir') ?? undefined,
  });

  if (!analyse.success) {
    return NextResponse.json(
      { erreur: analyse.error.issues[0]?.message ?? 'Paramètres invalides.' },
      { status: 400 },
    );
  }

  let client: ReturnType<typeof clientAdmin>;
  try {
    client = clientAdmin();
  } catch {
    return NextResponse.json(
      {
        erreur:
          'Configuration serveur incomplète : SUPABASE_SERVICE_ROLE_KEY est absente. ' +
          'Les données de marché ne peuvent pas être mises en cache.',
      },
      { status: 503 },
    );
  }

  try {
    const resultat = await obtenirChandeliers({
      client,
      profilId,
      symbole: analyse.data.symbole,
      intervalle: analyse.data.intervalle,
      limite: analyse.data.limite,
      ignorerCache: analyse.data.rafraichir === '1',
      signal: requete.signal,
    });

    return NextResponse.json(resultat, {
      // Jamais de cache HTTP : la fraîcheur est gérée par le routeur, qui sait
      // distinguer une bougie fermée d'une bougie en formation.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (erreur) {
    if (erreur instanceof ErreurDonneesIndisponibles) {
      return NextResponse.json(
        { erreur: erreur.message, incidents: erreur.incidents },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' },
      { status: 500 },
    );
  }
}
