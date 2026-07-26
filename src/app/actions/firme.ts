'use server';

import { revalidatePath } from 'next/cache';

import { exigerModeAutorise, type ModeOperation } from '@/lib/config/drapeaux';
import { clientServeur } from '@/lib/supabase/serveur';

export interface ResultatAction {
  readonly ok: boolean;
  readonly message?: string;
}

const MODES_CONNUS: readonly ModeOperation[] = [
  'PAPIER_AUTONOME',
  'PAPIER_VALIDATION',
  'REEL_VALIDATION',
];

function estMode(valeur: string): valeur is ModeOperation {
  return (MODES_CONNUS as readonly string[]).includes(valeur);
}

/**
 * Change le mode d'opération. Le refus du mode réel est vérifié ici, mais la
 * garantie réelle vient du trigger PostgreSQL : cette action n'est que la
 * première des trois barrières.
 */
export async function changerMode(mode: string): Promise<ResultatAction> {
  if (!estMode(mode)) {
    return { ok: false, message: 'Mode inconnu.' };
  }

  try {
    exigerModeAutorise(mode);
  } catch (erreur) {
    return { ok: false, message: erreur instanceof Error ? erreur.message : 'Mode refusé.' };
  }

  const supabase = await clientServeur();
  const { data: session } = await supabase.auth.getClaims();
  const profilId = session?.claims?.sub;
  if (typeof profilId !== 'string') {
    return { ok: false, message: 'Session expirée.' };
  }

  const { error } = await supabase.from('profils').update({ mode_operation: mode }).eq('id', profilId);
  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Kill switch. L'écriture passe par une fonction SECURITY DEFINER en base :
 * les tables comptables restent en lecture seule pour le navigateur, et
 * l'opération est journalisée dans journal_audit côté serveur.
 */
export async function declencherKillSwitch(raison?: string): Promise<ResultatAction> {
  const supabase = await clientServeur();
  const { error } = await supabase.rpc('declencher_kill_switch', {
    p_raison: raison ?? 'Kill switch déclenché depuis l’interface',
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Agents arrêtés, ordres en attente annulés, portefeuille gelé.' };
}

/** Le dégel est délibérément séparé : après un arrêt d'urgence, rien ne
 *  redémarre sans une action explicite. */
export async function leverKillSwitch(): Promise<ResultatAction> {
  const supabase = await clientServeur();
  const { error } = await supabase.rpc('lever_kill_switch');

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Portefeuille dégelé. Les agents restent inactifs.' };
}
