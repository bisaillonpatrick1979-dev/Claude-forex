'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { raisonIndisponibilite } from '@/lib/agents/enveloppe';
import { chargerEnveloppe } from '@/lib/agents/enveloppe-serveur';
import { estIntervalle } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';
import { lancerCycle } from '@/lib/orchestration/cycle';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Déclenchement d'un cycle de décision depuis la salle des marchés.
 *
 * Le cycle est exécuté dans la requête, pas mis en file : sur le palier
 * gratuit de Vercel il n'y a pas de file d'attente, et une file bricolée à
 * coups de `setTimeout` ne survit pas à la fin de la fonction. La contrepartie
 * est un temps de réponse long ; l'interface ne l'attend pas, elle suit le fil
 * en Realtime. Un cycle qui dépasse la durée maximale d'une fonction laisse
 * quand même toutes ses étapes déjà écrites en base — c'est ce que garantit
 * l'écriture à chaque transition.
 */

export interface ResultatLancement {
  readonly ok: boolean;
  readonly message: string;
  readonly cycleId: string | null;
  readonly coutUsd?: number;
}

const schema = z.object({
  symbole: z.string().min(1).max(20),
  intervalle: z.string().refine(estIntervalle, 'Intervalle inconnu.'),
});

export async function lancerCycleAgents(
  symbole: string,
  intervalle: string,
): Promise<ResultatLancement> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.', cycleId: null };

  // Un cycle coûte de l'argent réel dès qu'un fournisseur payant est
  // configuré : la limite est volontairement basse.
  if (!limiterDebit(`cycle:${profilId}`, 6, 60_000).autorise) {
    return {
      ok: false,
      message: 'Trop de cycles coup sur coup. Réessaie dans une minute.',
      cycleId: null,
    };
  }

  const analyse = schema.safeParse({ symbole, intervalle });
  if (!analyse.success) {
    return {
      ok: false,
      message: analyse.error.issues[0]?.message ?? 'Saisie invalide.',
      cycleId: null,
    };
  }

  const client = clientAdminOptionnel();
  if (!client) {
    return {
      ok: false,
      message: 'SUPABASE_SERVICE_ROLE_KEY absente côté serveur.',
      cycleId: null,
    };
  }

  const resultat = await lancerCycle({
    client,
    profilId,
    symbole: analyse.data.symbole,
    intervalle: analyse.data.intervalle as Intervalle,
    declencheur: 'MANUEL',
  });

  revalidatePath('/salle-des-marches');
  revalidatePath('/validation');

  return {
    ok: resultat.ok,
    message: resultat.message,
    cycleId: resultat.cycleId,
    coutUsd: resultat.coutUsd,
  };
}

export interface ResultatEnveloppe {
  readonly ok: boolean;
  readonly message: string;
}

const schemaAllocation = z.object({
  montant: z.coerce
    .number()
    .min(0, 'Le montant confié ne peut pas être négatif.')
    .max(100_000_000, 'Montant trop élevé.'),
});

/**
 * Montant que l'utilisateur confie aux agents.
 *
 * Le plafond est l'équité disponible : confier plus que ce qu'on possède
 * produirait des tailles de position que le compte ne peut pas soutenir, et
 * les garde-fous les refuseraient une par une sans jamais dire pourquoi.
 */
export async function definirAllocationAgents(montant: number): Promise<ResultatEnveloppe> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  const analyse = schemaAllocation.safeParse({ montant });
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Montant invalide.' };
  }

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY absente côté serveur.' };

  const { data: portefeuille } = await client
    .from('portefeuilles')
    .select('id, equite, devise')
    .eq('profil_id', profilId)
    .limit(1)
    .maybeSingle();

  if (!portefeuille) return { ok: false, message: 'Aucun portefeuille pour ce profil.' };

  const equite = Number(portefeuille.equite);
  if (analyse.data.montant > equite) {
    return {
      ok: false,
      message: `Vous ne pouvez pas confier ${analyse.data.montant.toFixed(2)} : l’équité du compte est de ${equite.toFixed(2)} ${portefeuille.devise}.`,
    };
  }

  const { error } = await client
    .from('portefeuilles')
    .update({ capital_alloue_agents: analyse.data.montant })
    .eq('id', portefeuille.id);

  if (error) return { ok: false, message: error.message };

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'ALLOCATION_AGENTS',
    entite: 'portefeuilles',
    entite_id: portefeuille.id,
    details: { montant: analyse.data.montant, devise: portefeuille.devise },
  });

  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    message:
      analyse.data.montant > 0
        ? `Les agents disposent désormais de ${analyse.data.montant.toFixed(2)} ${portefeuille.devise}.`
        : 'Capital retiré aux agents : ils peuvent encore analyser, plus ouvrir de position.',
  };
}

/** État de l'enveloppe pour l'affichage, sans passer par le rendu serveur —
 *  utilisé après une modification pour rafraîchir sans recharger la page. */
export async function lireEnveloppeAgents(): Promise<{
  readonly alloue: number;
  readonly profits: number;
  readonly pertes: number;
  readonly latent: number;
  readonly valeurCourante: number;
} | null> {
  const profilId = await profilAuthentifie();
  if (!profilId) return null;

  const client = clientAdminOptionnel();
  if (!client) return null;

  const enveloppe = await chargerEnveloppe(client, profilId);
  return {
    alloue: enveloppe.alloue,
    profits: enveloppe.profitsRealises,
    pertes: enveloppe.pertesRealisees,
    latent: enveloppe.latent,
    valeurCourante: enveloppe.valeurCourante,
  };
}

/** Message expliquant pourquoi les agents ne peuvent rien engager, ou `null`. */
export async function verifierEnveloppe(): Promise<string | null> {
  const profilId = await profilAuthentifie();
  if (!profilId) return 'Session expirée.';

  const client = clientAdminOptionnel();
  if (!client) return 'Configuration serveur incomplète.';

  return raisonIndisponibilite(await chargerEnveloppe(client, profilId));
}
