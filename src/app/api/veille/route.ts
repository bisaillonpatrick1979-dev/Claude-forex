import { NextResponse, type NextRequest } from 'next/server';

import { budgetSuffisant, etatBudget } from '@/lib/ia/budget';
import { estIntervalle } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';
import { etatArret } from '@/lib/orchestration/arret';
import { lancerCycle } from '@/lib/orchestration/cycle';
import { clientAdminOptionnel } from '@/lib/supabase/admin';

/**
 * Veille déclenchée par un ordonnanceur, pas par un navigateur.
 *
 * Le pilote automatique de la salle des marchés vit dans l'onglet : le fermer
 * l'arrête. Ce point d'entrée existe pour que la firme travaille sans que
 * personne ne regarde — appelé par un cron.
 *
 * Ce qu'il faut savoir avant de compter dessus : le palier gratuit de Vercel
 * limite les tâches planifiées à un déclenchement par jour. Une veille
 * réellement continue suppose un forfait payant, ou un ordonnanceur externe
 * (GitHub Actions, cron-job.org) qui appelle cette route. Rien n'est activé
 * automatiquement : c'est une décision de dépense, elle appartient au
 * propriétaire de la firme.
 *
 * Authentification par secret partagé et non par session : un ordonnanceur n'a
 * pas de cookie. Sans `SECRET_VEILLE` configuré, la route refuse tout — une
 * route qui déclenche des dépenses ne doit jamais être ouverte par défaut.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function refus(message: string, statut: number) {
  return NextResponse.json({ ok: false, message }, { status: statut });
}

export async function GET(requete: NextRequest) {
  const secret = process.env.SECRET_VEILLE?.trim();
  if (!secret) {
    return refus(
      'SECRET_VEILLE non configuré côté serveur : la veille planifiée est désactivée.',
      503,
    );
  }

  // Deux formes acceptées : l'en-tête standard des crons Vercel, et un
  // paramètre pour les ordonnanceurs qui ne savent pas poser d'en-tête.
  const enTete = requete.headers.get('authorization');
  const fourni =
    enTete?.startsWith('Bearer ') === true
      ? enTete.slice(7).trim()
      : requete.nextUrl.searchParams.get('secret')?.trim();

  if (fourni !== secret) {
    return refus('Secret invalide.', 401);
  }

  const symbole = requete.nextUrl.searchParams.get('symbole') ?? 'EURUSD';
  const intervalleBrut = requete.nextUrl.searchParams.get('intervalle') ?? 'M15';
  if (!estIntervalle(intervalleBrut)) return refus('Intervalle inconnu.', 400);

  const client = clientAdminOptionnel();
  if (!client) return refus('SUPABASE_SERVICE_ROLE_KEY absente côté serveur.', 503);

  // Un cron ne porte pas de session : le profil est nommé explicitement. Sur
  // une installation mono-utilisateur c'est le seul profil ; la variable évite
  // d'avoir à le deviner et rend le comportement explicite si un second
  // compte apparaît.
  const profilId = process.env.PROFIL_VEILLE?.trim();
  if (!profilId) {
    return refus(
      'PROFIL_VEILLE non configuré : impossible de savoir pour quel compte veiller.',
      503,
    );
  }

  const budget = await etatBudget(client, profilId);
  if (!budgetSuffisant(budget)) {
    return NextResponse.json({
      ok: true,
      aTravaille: false,
      message: `Plafond quotidien atteint (${budget.depenseUsd.toFixed(2)} $ sur ${budget.plafondUsd.toFixed(2)} $).`,
    });
  }

  // Le kill switch doit couper l'ordonnanceur aussi. Sinon un cron continue de
  // faire délibérer une firme que son propriétaire a explicitement arrêtée —
  // et c'est justement le chemin qu'aucun onglet fermé n'interrompt.
  const arret = await etatArret(client, profilId);
  if (arret.gele) {
    return NextResponse.json({
      ok: true,
      aTravaille: false,
      message: arret.raison ?? 'Firme arrêtée.',
    });
  }

  const resultat = await lancerCycle({
    client,
    profilId,
    symbole,
    intervalle: intervalleBrut as Intervalle,
    declencheur: 'PLANIFIE',
  });

  return NextResponse.json({
    ok: resultat.ok,
    aTravaille: true,
    cycleId: resultat.cycleId,
    message: resultat.message,
    coutUsd: resultat.coutUsd,
  });
}
