'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { raisonIndisponibilite } from '@/lib/agents/enveloppe';
import { chargerEnveloppe } from '@/lib/agents/enveloppe-serveur';
import { chargerInstrument } from '@/lib/execution/persistance';
import { budgetSuffisant, etatBudget } from '@/lib/ia/budget';
import { estIntervalle } from '@/lib/marche/intervalles';
import { obtenirChandeliers } from '@/lib/marche/routeur';
import type { Intervalle } from '@/lib/marche/types';
import { lancerCycle } from '@/lib/orchestration/cycle';
import { reflechirSurPositionsFermees } from '@/lib/orchestration/reflexion';
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

export interface ResultatVeille {
  readonly ok: boolean;
  readonly message: string;
  readonly cycleId: string | null;
  readonly aTravaille: boolean;
  /** Horodatage de la dernière bougie analysée, pour l'affichage. */
  readonly derniereBougie: number | null;
}

/**
 * Un tour de veille : analyser seulement s'il y a du nouveau.
 *
 * C'est la différence entre une firme qui travaille en continu et une firme qui
 * brûle du budget. Relancer une délibération complète sur exactement les mêmes
 * bougies produit exactement la même conclusion, en la facturant une seconde
 * fois. La veille ne déclenche donc un cycle que lorsqu'une bougie s'est
 * fermée depuis le dernier cycle sur ce couple symbole/intervalle.
 *
 * Conséquence assumée : en M5, les agents délibèrent au plus toutes les cinq
 * minutes, quelle que soit la fréquence à laquelle on appelle cette fonction.
 * Pour les faire travailler plus souvent, on descend l'intervalle ou on lance
 * un rejeu — c'est ce que fait le mode accéléré.
 */
export async function veiller(
  symbole: string,
  intervalle: string,
): Promise<ResultatVeille> {
  const profilId = await profilAuthentifie();
  if (!profilId) {
    return {
      ok: false,
      message: 'Session expirée.',
      cycleId: null,
      aTravaille: false,
      derniereBougie: null,
    };
  }

  const analyse = schema.safeParse({ symbole, intervalle });
  if (!analyse.success) {
    return {
      ok: false,
      message: analyse.error.issues[0]?.message ?? 'Saisie invalide.',
      cycleId: null,
      aTravaille: false,
      derniereBougie: null,
    };
  }

  const client = clientAdminOptionnel();
  if (!client) {
    return {
      ok: false,
      message: 'SUPABASE_SERVICE_ROLE_KEY absente côté serveur.',
      cycleId: null,
      aTravaille: false,
      derniereBougie: null,
    };
  }

  // Budget d'abord : inutile de charger le marché pour découvrir ensuite qu'on
  // ne peut rien dépenser.
  const budget = await etatBudget(client, profilId);
  if (!budgetSuffisant(budget)) {
    return {
      ok: false,
      message: `Plafond quotidien atteint (${budget.depenseUsd.toFixed(2)} $ sur ${budget.plafondUsd.toFixed(2)} $). La veille reprend demain (UTC).`,
      cycleId: null,
      aTravaille: false,
      derniereBougie: null,
    };
  }

  const instrument = await chargerInstrument(client, analyse.data.symbole);
  if (!instrument) {
    return {
      ok: false,
      message: `Instrument ${analyse.data.symbole} inconnu.`,
      cycleId: null,
      aTravaille: false,
      derniereBougie: null,
    };
  }

  let derniereBougie: number | null = null;
  try {
    const marche = await obtenirChandeliers({
      client,
      profilId,
      symbole: analyse.data.symbole,
      intervalle: analyse.data.intervalle as Intervalle,
      limite: 2,
    });
    derniereBougie = marche.chandeliers[marche.chandeliers.length - 1]?.horodatage ?? null;
  } catch (erreur) {
    return {
      ok: false,
      message: `Données indisponibles : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}.`,
      cycleId: null,
      aTravaille: false,
      derniereBougie: null,
    };
  }

  if (derniereBougie === null) {
    return {
      ok: false,
      message: 'Aucune bougie disponible.',
      cycleId: null,
      aTravaille: false,
      derniereBougie: null,
    };
  }

  // Le dernier cycle sur ce couple a-t-il déjà vu cette bougie ?
  const { data: dernierCycle } = await client
    .from('cycles')
    .select('id, instantane_donnees')
    .eq('profil_id', profilId)
    .eq('symbole_id', instrument.symboleId)
    .eq('intervalle', analyse.data.intervalle)
    .in('etat', ['TERMINE', 'ECHOUE'])
    .order('demarre_le', { ascending: false })
    .limit(1)
    .maybeSingle();

  const instantanePrecedent = dernierCycle?.instantane_donnees as
    | { chandeliers?: { horodatage?: number }[] }
    | null;
  const derniereVue =
    instantanePrecedent?.chandeliers?.[instantanePrecedent.chandeliers.length - 1]?.horodatage ??
    null;

  if (derniereVue !== null && derniereVue >= derniereBougie) {
    return {
      ok: true,
      message: 'Rien de nouveau : la dernière bougie a déjà été analysée.',
      cycleId: null,
      aTravaille: false,
      derniereBougie,
    };
  }

  const resultat = await lancerCycle({
    client,
    profilId,
    symbole: analyse.data.symbole,
    intervalle: analyse.data.intervalle as Intervalle,
    declencheur: 'PLANIFIE',
  });

  revalidatePath('/salle-des-marches');
  revalidatePath('/validation');

  return {
    ok: resultat.ok,
    message: resultat.message,
    cycleId: resultat.cycleId,
    aTravaille: true,
    derniereBougie,
  };
}

export interface ResultatDebrief {
  readonly ok: boolean;
  readonly message: string;
  readonly leconsEcrites: number;
}

/**
 * Débrief manuel des positions fermées.
 *
 * Le cycle en déclenche déjà un à chaque passage ; ce bouton sert à rattraper
 * l'arriéré sans lancer une délibération complète — typiquement après un rejeu
 * qui a fermé trente positions d'un coup.
 */
export async function debrieferPositions(): Promise<ResultatDebrief> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.', leconsEcrites: 0 };

  if (!limiterDebit(`debrief:${profilId}`, 10, 60_000).autorise) {
    return {
      ok: false,
      message: 'Trop de débriefs coup sur coup. Réessaie dans une minute.',
      leconsEcrites: 0,
    };
  }

  const client = clientAdminOptionnel();
  if (!client) {
    return {
      ok: false,
      message: 'SUPABASE_SERVICE_ROLE_KEY absente côté serveur.',
      leconsEcrites: 0,
    };
  }

  const resultat = await reflechirSurPositionsFermees(client, profilId, 5);
  revalidatePath('/salle-des-marches');
  return resultat;
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
