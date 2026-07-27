'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chargerAgentParCle, compterTradesDuJour } from '@/lib/agents/depot';
import { portefeuilleDesAgents, raisonIndisponibilite, type EnveloppeAgents } from '@/lib/agents/enveloppe';
import { chargerEnveloppe } from '@/lib/agents/enveloppe-serveur';
import {
  evaluerPermission,
  fusionnerRisque,
  type ControlePermission,
  type DecisionPermission,
  type PermissionAgent,
} from '@/lib/agents/permissions';
import type { ModeOperation } from '@/lib/config/drapeaux';
import {
  contexteDepuisMarche,
  lireParametresRisque,
  type ClientAdmin,
} from '@/lib/execution/contexte-serveur';
import { chargerEtat } from '@/lib/execution/persistance';
import { estIntervalle } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';
import { evaluerGardeFous, type DecisionGardeFous } from '@/lib/risque/garde-fous';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Chemin d'une décision d'agent, de la proposition à l'ordre.
 *
 * Deux barrières, toujours dans cet ordre et jamais contournables :
 *
 *   1. `evaluerPermission` — cet agent a-t-il le droit, et faut-il un humain ?
 *   2. `evaluerGardeFous`  — quelle taille le portefeuille supporte-t-il ?
 *
 * Chaque passage laisse une ligne dans `propositions_ordres`, y compris les
 * refus : une décision refusée doit rester visible, sinon on ne peut pas
 * expliquer après coup pourquoi un agent n'a rien fait de la journée.
 *
 * C'est ce module que l'orchestrateur de la phase 4b appellera. Le banc d'essai
 * de la page Agents l'appelle déjà, avec les mêmes contrôles : ce qui est testé
 * là est exactement ce qui tournera en automatique.
 */

export interface ControleAffiche {
  readonly origine: 'PERMISSION' | 'RISQUE';
  readonly code: string;
  readonly libelle: string;
  readonly statut: string;
  readonly detail: string;
}

export interface ResultatProposition {
  readonly ok: boolean;
  readonly verdict: 'AUTONOME' | 'VALIDATION_REQUISE' | 'REFUSE' | null;
  readonly message: string;
  readonly controles: readonly ControleAffiche[];
}

const CONFIG_MANQUANTE =
  'SUPABASE_SERVICE_ROLE_KEY absente côté serveur : le moteur d’exécution ne peut pas écrire.';

const schemaProposition = z.object({
  agentCle: z.string().min(1).max(64),
  symbole: z.string().min(1).max(20),
  intervalle: z.string().refine(estIntervalle, 'Intervalle inconnu.'),
  sens: z.enum(['ACHAT', 'VENTE']),
  type: z.enum(['MARCHE', 'LIMITE', 'STOP']),
  quantite: z.coerce.number().positive().max(500),
  prixDemande: z.coerce.number().positive().nullable(),
  stopLoss: z.coerce.number().positive().nullable(),
  takeProfit: z.coerce.number().positive().nullable(),
  raisonnement: z.string().min(1).max(4000),
  confiance: z.coerce.number().int().min(0).max(100).nullable(),
  /** Cycle d'orchestration d'où sort la proposition. Absent quand elle vient
   *  du banc d'essai de la page Agents. */
  cycleId: z.string().uuid().nullable().optional(),
});

export type SaisieProposition = z.input<typeof schemaProposition>;

function controlesPermission(decision: DecisionPermission): ControleAffiche[] {
  return decision.controles.map((controle: ControlePermission) => ({
    origine: 'PERMISSION' as const,
    ...controle,
  }));
}

function controlesRisque(decision: DecisionGardeFous): ControleAffiche[] {
  return decision.controles.map((controle) => ({ origine: 'RISQUE' as const, ...controle }));
}

async function journaliser(
  client: ClientAdmin,
  profilId: string,
  action: string,
  propositionId: string | null,
  details: Record<string, string | number | boolean | null>,
): Promise<void> {
  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'agent',
    action,
    entite: 'propositions_ordres',
    entite_id: propositionId,
    details,
  });
}

async function enregistrerDecisionRisque(
  client: ClientAdmin,
  profilId: string,
  propositionId: string,
  quantiteDemandee: number,
  decision: DecisionGardeFous,
): Promise<void> {
  await client.from('decisions_risque').insert({
    profil_id: profilId,
    proposition_id: propositionId,
    decision: decision.decision,
    raison: decision.raison,
    quantite_demandee: quantiteDemandee,
    quantite_autorisee: decision.quantiteAutorisee,
    risque_estime_pct: decision.risqueEstimePct,
    controles: decision.controles as unknown as never,
  });
}

/**
 * Prépare tout ce dont les deux barrières ont besoin : marché, portefeuille,
 * paramètres de risque. Partagé entre la soumission et la validation, pour que
 * les deux chemins évaluent exactement les mêmes choses.
 */
async function preparerEvaluation(
  client: ClientAdmin,
  profilId: string,
  symbole: string,
  intervalle: Intervalle,
) {
  const marche = await contexteDepuisMarche(client, profilId, symbole, intervalle);
  if (!marche.ok) return { ok: false as const, message: marche.message };

  const persiste = await chargerEtat(client, profilId, symbole);
  if (!persiste) return { ok: false as const, message: 'Aucun portefeuille pour ce profil.' };

  const parametres = await lireParametresRisque(client, profilId);
  if (!parametres) return { ok: false as const, message: 'Paramètres de risque introuvables.' };

  return { ok: true as const, marche, persiste, parametres };
}

type Preparation = Extract<Awaited<ReturnType<typeof preparerEvaluation>>, { ok: true }>;

function controlerRisque(
  preparation: Preparation,
  permission: PermissionAgent,
  sens: 'ACHAT' | 'VENTE',
  quantite: number,
  prixDemande: number | null,
  stopLoss: number | null,
  parametresProfil: Preparation['parametres'],
  enveloppe: EnveloppeAgents,
): DecisionGardeFous {
  const { marche, persiste } = preparation;
  const prixReference = prixDemande ?? marche.contexte.bougie.cloture;

  return evaluerGardeFous(
    {
      instrument: marche.contexte.instrument,
      sens,
      quantite,
      prixEntree: prixReference,
      stopLoss,
      tauxCotationVersCompte: marche.contexte.tauxCotationVersCompte,
    },
    {
      // ═══ Les agents dimensionnent sur l'enveloppe qu'on leur a confiée, pas
      //     sur le compte entier. Sans allocation, l'équité vue est nulle et
      //     toute ouverture est refusée — défaut fermé. ═══
      portefeuille: portefeuilleDesAgents(persiste.etat.portefeuille, enveloppe),
      positions: persiste.etat.positions.map((position) => ({
        position,
        instrument: marche.contexte.instrument,
        tauxCotationVersCompte: marche.contexte.tauxCotationVersCompte ?? 1,
        prixCourant: marche.contexte.bougie.cloture,
      })),
      equiteDebutJournee: portefeuilleDesAgents(persiste.etat.portefeuille, enveloppe).equite,
      evenementsMacro: [],
      maintenant: marche.contexte.bougie.horodatage,
    },
    // Le plafond propre à l'agent ne peut que resserrer celui du portefeuille.
    fusionnerRisque(parametresProfil, permission),
  );
}

async function creerOrdre(
  client: ClientAdmin,
  parametres: {
    profilId: string;
    portefeuilleId: string;
    symboleId: string;
    propositionId: string;
    sens: 'ACHAT' | 'VENTE';
    type: 'MARCHE' | 'LIMITE' | 'STOP';
    quantite: number;
    prixDemande: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    horodatageDecision: number;
  },
): Promise<string | null> {
  const { error } = await client.from('ordres').insert({
    profil_id: parametres.profilId,
    portefeuille_id: parametres.portefeuilleId,
    symbole_id: parametres.symboleId,
    proposition_id: parametres.propositionId,
    sens: parametres.sens,
    type_ordre: parametres.type,
    quantite: parametres.quantite,
    prix_demande: parametres.prixDemande,
    stop_loss: parametres.stopLoss,
    take_profit: parametres.takeProfit,
    statut: 'EN_ATTENTE',
    // Marque l'ordre comme venant des agents : c'est ce qui permettra
    // d'imputer son résultat à l'enveloppe qui leur est confiée.
    origine: 'AGENT',
    // Daté de la dernière bougie connue : aucun remplissage ne peut avoir lieu
    // avant la suivante. Même barrière anti-look-ahead que l'ordre manuel.
    cree_le: new Date(parametres.horodatageDecision * 1000).toISOString(),
  });

  return error ? error.message : null;
}

export async function soumettreProposition(
  saisie: SaisieProposition,
): Promise<ResultatProposition> {
  const profilId = await profilAuthentifie();
  if (!profilId) {
    return { ok: false, verdict: null, message: 'Session expirée.', controles: [] };
  }

  if (!limiterDebit(`proposition:${profilId}`, 60, 60_000).autorise) {
    return {
      ok: false,
      verdict: null,
      message: 'Trop de propositions coup sur coup, réessaie dans une minute.',
      controles: [],
    };
  }

  const analyse = schemaProposition.safeParse(saisie);
  if (!analyse.success) {
    return {
      ok: false,
      verdict: null,
      message: analyse.error.issues[0]?.message ?? 'Saisie invalide.',
      controles: [],
    };
  }
  const donnees = analyse.data;
  const intervalle = donnees.intervalle as Intervalle;

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, verdict: null, message: CONFIG_MANQUANTE, controles: [] };

  const agent = await chargerAgentParCle(client, profilId, donnees.agentCle);
  if (!agent) {
    return {
      ok: false,
      verdict: null,
      message: `Agent « ${donnees.agentCle} » introuvable.`,
      controles: [],
    };
  }

  const { data: profil } = await client
    .from('profils')
    .select('mode_operation')
    .eq('id', profilId)
    .maybeSingle();

  const preparation = await preparerEvaluation(client, profilId, donnees.symbole, intervalle);
  if (!preparation.ok) {
    return { ok: false, verdict: null, message: preparation.message, controles: [] };
  }

  const maintenant = Math.floor(Date.now() / 1000);
  const tradesDuJour = await compterTradesDuJour(client, profilId, agent.id, new Date());

  // ═══ Barrière 0 : le capital confié. Sans allocation, les agents analysent
  //     et débattent, mais n'engagent rien. ═══
  const enveloppe = await chargerEnveloppe(client, profilId);
  const enveloppeIndisponible = raisonIndisponibilite(enveloppe);
  if (enveloppeIndisponible) {
    return { ok: false, verdict: 'REFUSE', message: enveloppeIndisponible, controles: [] };
  }

  // ═══ Barrière 1 : le droit d'agir ═══
  const permission = evaluerPermission(
    {
      action: 'OUVERTURE',
      symbole: donnees.symbole,
      classeActif: preparation.marche.contexte.instrument.classeActif,
      quantite: donnees.quantite,
      confiance: donnees.confiance,
    },
    agent.permission,
    {
      role: agent.role,
      agentActif: agent.actif,
      modeOperation: (profil?.mode_operation ?? 'PAPIER_VALIDATION') as ModeOperation,
      portefeuilleGele: preparation.persiste.etat.portefeuille.gele,
      tradesAujourdHui: tradesDuJour,
      maintenant,
    },
  );

  const { data: proposition, error: erreurProposition } = await client
    .from('propositions_ordres')
    .insert({
      profil_id: profilId,
      portefeuille_id: preparation.persiste.portefeuilleId,
      symbole_id: preparation.marche.symboleId,
      agent_id: agent.id,
      cycle_id: donnees.cycleId ?? null,
      intervalle,
      sens: donnees.sens,
      type_ordre: donnees.type,
      quantite: donnees.quantite,
      prix_entree: donnees.prixDemande,
      stop_loss: donnees.stopLoss,
      take_profit: donnees.takeProfit,
      raisonnement: donnees.raisonnement,
      statut: 'PROPOSEE',
    })
    .select('id')
    .single();

  if (erreurProposition || !proposition) {
    return {
      ok: false,
      verdict: null,
      message: erreurProposition?.message ?? 'Proposition non enregistrée.',
      controles: [],
    };
  }

  if (permission.verdict === 'REFUSE') {
    await client
      .from('propositions_ordres')
      .update({ statut: 'REFUSEE_PERMISSION', decide_le: new Date().toISOString() })
      .eq('id', proposition.id);

    await journaliser(client, profilId, 'PERMISSION_AGENT_REFUS', proposition.id, {
      agent: agent.cle,
      symbole: donnees.symbole,
      raison: permission.raison,
    });

    revalidatePath('/agents');
    return {
      ok: false,
      verdict: 'REFUSE',
      message: `${agent.nom} : ${permission.raison}`,
      controles: controlesPermission(permission),
    };
  }

  // ═══ Barrière 2 : la taille que le portefeuille supporte ═══
  const risque = controlerRisque(
    preparation,
    agent.permission,
    donnees.sens,
    permission.quantiteAutorisee,
    donnees.prixDemande,
    donnees.stopLoss,
    preparation.parametres,
    enveloppe,
  );

  await enregistrerDecisionRisque(
    client,
    profilId,
    proposition.id,
    permission.quantiteAutorisee,
    risque,
  );

  const controles = [...controlesPermission(permission), ...controlesRisque(risque)];

  if (risque.decision === 'REFUSE') {
    await client
      .from('propositions_ordres')
      .update({ statut: 'REJETEE_RISQUE', decide_le: new Date().toISOString() })
      .eq('id', proposition.id);

    await journaliser(client, profilId, 'CONTROLE_RISQUE_PROPOSITION', proposition.id, {
      agent: agent.cle,
      decision: risque.decision,
      raison: risque.raison,
    });

    revalidatePath('/agents');
    return { ok: false, verdict: 'REFUSE', message: `${agent.nom} : ${risque.raison}`, controles };
  }

  if (permission.verdict === 'VALIDATION_REQUISE') {
    await client
      .from('propositions_ordres')
      .update({
        statut: 'EN_ATTENTE_VALIDATION',
        quantite: risque.quantiteAutorisee,
        valide_jusqu_a: new Date((permission.expireLe ?? maintenant + 1800) * 1000).toISOString(),
      })
      .eq('id', proposition.id);

    await journaliser(client, profilId, 'PROPOSITION_EN_ATTENTE_VALIDATION', proposition.id, {
      agent: agent.cle,
      symbole: donnees.symbole,
      quantite: risque.quantiteAutorisee,
      raison: permission.raison,
    });

    revalidatePath('/agents');
    revalidatePath('/validation');
    return {
      ok: true,
      verdict: 'VALIDATION_REQUISE',
      message: `${agent.nom} : ${permission.raison} (${risque.quantiteAutorisee} lot(s) en attente).`,
      controles,
    };
  }

  const erreurOrdre = await creerOrdre(client, {
    profilId,
    portefeuilleId: preparation.persiste.portefeuilleId,
    symboleId: preparation.marche.symboleId,
    propositionId: proposition.id,
    sens: donnees.sens,
    type: donnees.type,
    quantite: risque.quantiteAutorisee,
    prixDemande: donnees.prixDemande,
    stopLoss: donnees.stopLoss,
    takeProfit: donnees.takeProfit,
    horodatageDecision: preparation.marche.contexte.bougie.horodatage,
  });

  if (erreurOrdre) {
    return { ok: false, verdict: null, message: erreurOrdre, controles };
  }

  await client
    .from('propositions_ordres')
    .update({
      statut: 'ACCEPTEE',
      quantite: risque.quantiteAutorisee,
      decide_le: new Date().toISOString(),
    })
    .eq('id', proposition.id);

  await journaliser(client, profilId, 'ORDRE_AGENT_AUTONOME', proposition.id, {
    agent: agent.cle,
    symbole: donnees.symbole,
    sens: donnees.sens,
    quantite: risque.quantiteAutorisee,
  });

  revalidatePath('/agents');
  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    verdict: 'AUTONOME',
    message: `${agent.nom} a exécuté seul : ${donnees.sens} ${risque.quantiteAutorisee} lot(s) sur ${donnees.symbole}. Remplissage à la prochaine bougie.`,
    controles,
  };
}

/**
 * Validation humaine d'une proposition en attente.
 *
 * Les deux barrières sont rejouées : la permission a pu changer depuis (agent
 * suspendu, kill switch), et surtout le marché a bougé — approuver sans
 * recontrôler le risque reviendrait à exécuter une taille calculée sur des prix
 * périmés.
 */
export async function approuverProposition(propositionId: string): Promise<ResultatProposition> {
  const profilId = await profilAuthentifie();
  if (!profilId) {
    return { ok: false, verdict: null, message: 'Session expirée.', controles: [] };
  }

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, verdict: null, message: CONFIG_MANQUANTE, controles: [] };

  const { data: proposition } = await client
    .from('propositions_ordres')
    .select(
      'id, statut, sens, type_ordre, quantite, prix_entree, stop_loss, take_profit, valide_jusqu_a, intervalle, agent_id, symboles (code), agents (cle, nom)',
    )
    .eq('id', propositionId)
    .eq('profil_id', profilId)
    .maybeSingle();

  if (!proposition) {
    return { ok: false, verdict: null, message: 'Proposition introuvable.', controles: [] };
  }
  if (proposition.statut !== 'EN_ATTENTE_VALIDATION') {
    return {
      ok: false,
      verdict: null,
      message: `Cette proposition n’est plus en attente (statut ${proposition.statut}).`,
      controles: [],
    };
  }

  const maintenant = Math.floor(Date.now() / 1000);
  if (
    proposition.valide_jusqu_a !== null &&
    new Date(proposition.valide_jusqu_a).getTime() / 1000 < maintenant
  ) {
    await client
      .from('propositions_ordres')
      .update({ statut: 'EXPIREE', decide_le: new Date().toISOString() })
      .eq('id', proposition.id);
    revalidatePath('/validation');
    return {
      ok: false,
      verdict: null,
      message: 'Proposition expirée : elle n’est plus exécutable, le marché a eu le temps de bouger.',
      controles: [],
    };
  }

  const symbole = proposition.symboles?.code;
  const agentCle = proposition.agents?.cle;
  if (!symbole || !agentCle) {
    return {
      ok: false,
      verdict: null,
      message: 'Proposition incomplète : symbole ou agent manquant.',
      controles: [],
    };
  }

  const agent = await chargerAgentParCle(client, profilId, agentCle);
  if (!agent) {
    return { ok: false, verdict: null, message: 'Agent introuvable.', controles: [] };
  }

  const intervalle = (proposition.intervalle ?? 'M5') as Intervalle;
  const preparation = await preparerEvaluation(client, profilId, symbole, intervalle);
  if (!preparation.ok) {
    return { ok: false, verdict: null, message: preparation.message, controles: [] };
  }

  const { data: profil } = await client
    .from('profils')
    .select('mode_operation')
    .eq('id', profilId)
    .maybeSingle();

  const quantiteDemandee = Number(proposition.quantite);
  const tradesDuJour = await compterTradesDuJour(client, profilId, agent.id, new Date());

  // L'enveloppe est relue au moment de la validation : elle a pu fondre depuis
  // que la proposition a été formulée, et approuver une taille calculée sur
  // l'enveloppe d'hier exécuterait une décision qui n'a plus de sens.
  const enveloppe = await chargerEnveloppe(client, profilId);
  const enveloppeIndisponible = raisonIndisponibilite(enveloppe);
  if (enveloppeIndisponible) {
    return { ok: false, verdict: 'REFUSE', message: enveloppeIndisponible, controles: [] };
  }

  // La validation lève l'exigence d'un humain, pas les droits de l'agent : un
  // agent suspendu ou désactivé entre-temps reste bloqué, et il faut le
  // réactiver explicitement pour que sa proposition parte.
  const permission = evaluerPermission(
    {
      action: 'OUVERTURE',
      symbole,
      classeActif: preparation.marche.contexte.instrument.classeActif,
      quantite: quantiteDemandee,
      confiance: null,
    },
    { ...agent.permission, confianceMinimale: null },
    {
      role: agent.role,
      agentActif: agent.actif,
      modeOperation: (profil?.mode_operation ?? 'PAPIER_VALIDATION') as ModeOperation,
      portefeuilleGele: preparation.persiste.etat.portefeuille.gele,
      tradesAujourdHui: tradesDuJour,
      maintenant,
    },
  );

  if (permission.verdict === 'REFUSE') {
    await client
      .from('propositions_ordres')
      .update({ statut: 'REFUSEE_PERMISSION', decide_le: new Date().toISOString() })
      .eq('id', proposition.id);
    revalidatePath('/validation');
    return {
      ok: false,
      verdict: 'REFUSE',
      message: `Validation impossible — ${permission.raison}`,
      controles: controlesPermission(permission),
    };
  }

  const risque = controlerRisque(
    preparation,
    agent.permission,
    proposition.sens,
    permission.quantiteAutorisee,
    proposition.prix_entree === null ? null : Number(proposition.prix_entree),
    proposition.stop_loss === null ? null : Number(proposition.stop_loss),
    preparation.parametres,
    enveloppe,
  );

  await enregistrerDecisionRisque(
    client,
    profilId,
    proposition.id,
    permission.quantiteAutorisee,
    risque,
  );

  const controles = [...controlesPermission(permission), ...controlesRisque(risque)];

  if (risque.decision === 'REFUSE') {
    await client
      .from('propositions_ordres')
      .update({ statut: 'REJETEE_RISQUE', decide_le: new Date().toISOString() })
      .eq('id', proposition.id);
    revalidatePath('/validation');
    return {
      ok: false,
      verdict: 'REFUSE',
      message: `Recontrôle au moment de la validation : ${risque.raison}`,
      controles,
    };
  }

  const erreurOrdre = await creerOrdre(client, {
    profilId,
    portefeuilleId: preparation.persiste.portefeuilleId,
    symboleId: preparation.marche.symboleId,
    propositionId: proposition.id,
    sens: proposition.sens,
    type: proposition.type_ordre,
    quantite: risque.quantiteAutorisee,
    prixDemande: proposition.prix_entree === null ? null : Number(proposition.prix_entree),
    stopLoss: proposition.stop_loss === null ? null : Number(proposition.stop_loss),
    takeProfit: proposition.take_profit === null ? null : Number(proposition.take_profit),
    horodatageDecision: preparation.marche.contexte.bougie.horodatage,
  });

  if (erreurOrdre) return { ok: false, verdict: null, message: erreurOrdre, controles };

  await client
    .from('propositions_ordres')
    .update({
      statut: 'ACCEPTEE',
      quantite: risque.quantiteAutorisee,
      decide_le: new Date().toISOString(),
    })
    .eq('id', proposition.id);

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'VALIDATION_PROPOSITION',
    entite: 'propositions_ordres',
    entite_id: proposition.id,
    details: {
      agent: agentCle,
      symbole,
      quantite_demandee: quantiteDemandee,
      quantite_executee: risque.quantiteAutorisee,
    },
  });

  revalidatePath('/validation');
  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    verdict: 'AUTONOME',
    message: `Validé : ${proposition.sens} ${risque.quantiteAutorisee} lot(s) sur ${symbole}. Remplissage à la prochaine bougie.`,
    controles,
  };
}

export async function refuserProposition(
  propositionId: string,
  raison?: string,
): Promise<ResultatProposition> {
  const profilId = await profilAuthentifie();
  if (!profilId) {
    return { ok: false, verdict: null, message: 'Session expirée.', controles: [] };
  }

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, verdict: null, message: CONFIG_MANQUANTE, controles: [] };

  const { error } = await client
    .from('propositions_ordres')
    .update({ statut: 'REFUSEE_UTILISATEUR', decide_le: new Date().toISOString() })
    .eq('id', propositionId)
    .eq('profil_id', profilId)
    .eq('statut', 'EN_ATTENTE_VALIDATION');

  if (error) return { ok: false, verdict: null, message: error.message, controles: [] };

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'REFUS_PROPOSITION',
    entite: 'propositions_ordres',
    entite_id: propositionId,
    details: { raison: raison ?? null },
  });

  revalidatePath('/validation');
  return { ok: true, verdict: null, message: 'Proposition refusée.', controles: [] };
}

/**
 * Passe en `EXPIREE` les propositions dont le délai est écoulé.
 *
 * Déclenché par l'affichage de la file plutôt que par un cron : tant qu'il n'y
 * a pas de tâche planifiée (phase 4b), une proposition périmée ne doit pas
 * pouvoir être approuvée par inadvertance, et l'écran est le seul endroit d'où
 * elle pourrait l'être.
 */
export async function archiverPropositionsExpirees(): Promise<{ ok: boolean; expirees: number }> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, expirees: 0 };

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, expirees: 0 };

  const { data } = await client
    .from('propositions_ordres')
    .update({ statut: 'EXPIREE', decide_le: new Date().toISOString() })
    .eq('profil_id', profilId)
    .eq('statut', 'EN_ATTENTE_VALIDATION')
    .lt('valide_jusqu_a', new Date().toISOString())
    .select('id');

  if (data && data.length > 0) revalidatePath('/validation');
  return { ok: true, expirees: data?.length ?? 0 };
}
