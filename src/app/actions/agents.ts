'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { clientServeur } from '@/lib/supabase/serveur';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Gouvernance des agents : niveau d'autonomie, droits, limites, périmètre,
 * mandat, modèle.
 *
 * Ces écritures passent par le client authentifié, pas par la clé service_role :
 * RLS reste la barrière, et les triggers en base (refus de l'autonomie pour un
 * rôle non exécutant, journal d'audit) s'appliquent quel que soit l'appelant.
 * Une action serveur qui contournerait RLS pour « simplifier » ferait sauter les
 * deux.
 */

export interface ResultatAgent {
  readonly ok: boolean;
  readonly message: string;
}

const NIVEAUX = ['OBSERVATEUR', 'PROPOSITION', 'AUTONOME'] as const;
const CLASSES = ['FOREX', 'INDICE', 'ACTION', 'CRYPTO', 'MATIERE_PREMIERE'] as const;
const DROITS = ['peut_ouvrir', 'peut_fermer', 'peut_modifier_protections'] as const;

type Niveau = (typeof NIVEAUX)[number];
type Droit = (typeof DROITS)[number];

function estNiveau(valeur: string): valeur is Niveau {
  return (NIVEAUX as readonly string[]).includes(valeur);
}

function estDroit(valeur: string): valeur is Droit {
  return (DROITS as readonly string[]).includes(valeur);
}

const schemaLimites = z.object({
  tailleMaxLots: z.coerce.number().positive().max(500).nullable(),
  risqueMaxParTradePct: z.coerce.number().positive().max(10).nullable(),
  tradesMaxParJour: z.coerce.number().int().min(0).max(500).nullable(),
  seuilValidationLots: z.coerce.number().positive().max(500).nullable(),
  confianceMinimale: z.coerce.number().int().min(0).max(100).nullable(),
  validiteValidationMinutes: z.coerce.number().int().min(1).max(1440),
});

export type SaisieLimites = z.input<typeof schemaLimites>;

const uuid = z.string().uuid();

async function contexte() {
  const profilId = await profilAuthentifie();
  if (!profilId) return null;
  return { profilId, supabase: await clientServeur() };
}

/** Traduit une erreur Postgres en message affichable. Le refus du trigger
 *  d'autonomie doit arriver tel quel à l'écran : c'est une règle métier, pas
 *  un incident technique. */
function messageErreur(erreur: { message: string }): string {
  return erreur.message.replace(/^.*?:\s*/, '').trim() || erreur.message;
}

export async function definirNiveauAutonomie(
  agentId: string,
  niveau: string,
): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };

  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };
  if (!estNiveau(niveau)) return { ok: false, message: 'Niveau d’autonomie inconnu.' };

  // Passer en observateur retire les droits d'action : garder « peut ouvrir »
  // sur un agent qu'on vient de mettre au placard donnerait une lecture fausse
  // de l'écran le jour où on le repasse en proposition.
  const champs =
    niveau === 'OBSERVATEUR'
      ? { niveau, peut_ouvrir: false, peut_fermer: false, peut_modifier_protections: false }
      : { niveau };

  const { error } = await ctx.supabase
    .from('permissions_agents')
    .update(champs)
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return {
    ok: true,
    message:
      niveau === 'AUTONOME'
        ? 'Agent autonome : il exécutera sans vous demander, dans ses limites.'
        : niveau === 'PROPOSITION'
          ? 'Agent en proposition : chaque ordre attendra votre validation.'
          : 'Agent en observateur : il n’agit plus sur le portefeuille.',
  };
}

export async function basculerDroit(
  agentId: string,
  droit: string,
  valeur: boolean,
): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };
  if (!estDroit(droit)) return { ok: false, message: 'Droit inconnu.' };

  const champs =
    droit === 'peut_ouvrir'
      ? { peut_ouvrir: valeur }
      : droit === 'peut_fermer'
        ? { peut_fermer: valeur }
        : { peut_modifier_protections: valeur };

  const { error } = await ctx.supabase
    .from('permissions_agents')
    .update(champs)
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return { ok: true, message: 'Droit mis à jour.' };
}

export async function enregistrerLimites(
  agentId: string,
  saisie: SaisieLimites,
): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };

  const analyse = schemaLimites.safeParse(saisie);
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Limite invalide.' };
  }
  const limites = analyse.data;

  const { error } = await ctx.supabase
    .from('permissions_agents')
    .update({
      taille_max_lots: limites.tailleMaxLots,
      risque_max_par_trade_pct: limites.risqueMaxParTradePct,
      trades_max_par_jour: limites.tradesMaxParJour,
      seuil_validation_lots: limites.seuilValidationLots,
      confiance_minimale: limites.confianceMinimale,
      validite_validation_minutes: limites.validiteValidationMinutes,
    })
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return { ok: true, message: 'Limites enregistrées.' };
}

export async function definirPerimetre(
  agentId: string,
  classes: readonly string[],
  symboles: readonly string[],
): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };

  const classesValides = classes.filter((classe) =>
    (CLASSES as readonly string[]).includes(classe),
  ) as ('FOREX' | 'INDICE' | 'ACTION' | 'CRYPTO' | 'MATIERE_PREMIERE')[];

  const symbolesValides = symboles
    .map((symbole) => symbole.trim().toUpperCase())
    .filter((symbole) => /^[A-Z0-9]{1,20}$/.test(symbole));

  const { error } = await ctx.supabase
    .from('permissions_agents')
    .update({ classes_autorisees: classesValides, symboles_autorises: symbolesValides })
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return {
    ok: true,
    message:
      classesValides.length === 0 && symbolesValides.length === 0
        ? 'Périmètre ouvert : aucune restriction d’instrument.'
        : 'Périmètre enregistré.',
  };
}

export async function suspendreAgent(agentId: string, minutes: number): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };

  const duree = z.coerce.number().int().min(1).max(10_080).safeParse(minutes);
  if (!duree.success) return { ok: false, message: 'Durée de suspension invalide.' };

  const jusqua = new Date(Date.now() + duree.data * 60_000);
  const { error } = await ctx.supabase
    .from('permissions_agents')
    .update({
      suspendu_jusqu_a: jusqua.toISOString(),
      raison_suspension: 'suspension manuelle',
    })
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return { ok: true, message: `Agent suspendu pour ${duree.data} minutes.` };
}

export async function reprendreAgent(agentId: string): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };

  const { error } = await ctx.supabase
    .from('permissions_agents')
    .update({ suspendu_jusqu_a: null, raison_suspension: null })
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return { ok: true, message: 'Suspension levée.' };
}

export async function basculerAgent(agentId: string, actif: boolean): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };

  const { error } = await ctx.supabase
    .from('agents')
    .update({ actif })
    .eq('id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return { ok: true, message: actif ? 'Agent réactivé.' : 'Agent désactivé.' };
}

/**
 * Reprise en main immédiate : tous les agents autonomes repassent en
 * proposition. Sans couper la firme, contrairement au kill switch — les agents
 * continuent d'analyser et de proposer, mais plus rien ne part sans vous.
 */
export async function toutMettreEnValidation(): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };

  const { data, error } = await ctx.supabase
    .from('permissions_agents')
    .update({ niveau: 'PROPOSITION' })
    .eq('profil_id', ctx.profilId)
    .eq('niveau', 'AUTONOME')
    .select('agent_id');

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  const nombre = data?.length ?? 0;
  return {
    ok: true,
    message:
      nombre === 0
        ? 'Aucun agent n’était autonome : rien ne partait déjà sans votre validation.'
        : `${nombre} agent(s) repassés en validation : plus rien ne s’exécute sans vous.`,
  };
}

const schemaModele = z.object({
  fournisseur: z.enum(['anthropic', 'openai', 'google', 'mock']),
  modele: z.string().min(1).max(80),
  temperature: z.coerce.number().min(0).max(2),
  tokensMax: z.coerce.number().int().min(256).max(32_000),
});

export type SaisieModele = z.input<typeof schemaModele>;

export async function definirModeleAgent(
  agentId: string,
  saisie: SaisieModele,
): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };

  const analyse = schemaModele.safeParse(saisie);
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Réglage de modèle invalide.' };
  }

  const { error } = await ctx.supabase
    .from('agents')
    .update({
      fournisseur_llm: analyse.data.fournisseur,
      modele: analyse.data.modele,
      temperature: analyse.data.temperature,
      tokens_max: analyse.data.tokensMax,
    })
    .eq('id', agentId)
    .eq('profil_id', ctx.profilId);

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return { ok: true, message: 'Modèle mis à jour.' };
}

/**
 * Nouvelle version du mandat. On n'écrase jamais : la version précédente est
 * désactivée mais conservée, pour pouvoir rattacher une décision passée au
 * texte qui l'a produite.
 */
export async function enregistrerMandat(agentId: string, contenu: string): Promise<ResultatAgent> {
  const ctx = await contexte();
  if (!ctx) return { ok: false, message: 'Session expirée.' };
  if (!uuid.safeParse(agentId).success) return { ok: false, message: 'Agent inconnu.' };

  const texte = contenu.trim();
  if (texte.length < 20) {
    return { ok: false, message: 'Un mandat de moins de 20 caractères ne dirige rien.' };
  }
  if (texte.length > 8000) return { ok: false, message: 'Mandat trop long (8000 caractères max).' };

  const { data: derniere } = await ctx.supabase
    .from('mandats_agents')
    .select('version, contenu')
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (derniere?.contenu.trim() === texte) {
    return { ok: true, message: 'Mandat inchangé : aucune version créée.' };
  }

  const { error: erreurDesactivation } = await ctx.supabase
    .from('mandats_agents')
    .update({ actif: false })
    .eq('agent_id', agentId)
    .eq('profil_id', ctx.profilId)
    .eq('actif', true);

  if (erreurDesactivation) return { ok: false, message: messageErreur(erreurDesactivation) };

  const { error } = await ctx.supabase.from('mandats_agents').insert({
    profil_id: ctx.profilId,
    agent_id: agentId,
    version: (derniere?.version ?? 0) + 1,
    contenu: texte,
    actif: true,
  });

  if (error) return { ok: false, message: messageErreur(error) };

  revalidatePath('/agents');
  return { ok: true, message: `Mandat enregistré en version ${(derniere?.version ?? 0) + 1}.` };
}
