import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

type Client = SupabaseClient<Database>;

/**
 * Plafond de dépense quotidienne en appels de modèles.
 *
 * Même principe que les garde-fous de risque : c'est du code serveur qui
 * refuse, pas une consigne dans un prompt. Un agent ne peut pas argumenter
 * pour dépasser le plafond, et un cycle qui l'atteint s'arrête net plutôt que
 * de finir « à peu près ».
 *
 * La journée est celle de l'UTC. Une journée locale exigerait de stocker le
 * fuseau de l'utilisateur ; tant que ce n'est pas fait, on le dit dans l'UI
 * plutôt que de deviner.
 */

export interface EtatBudget {
  readonly plafondUsd: number;
  readonly depenseUsd: number;
  readonly restantUsd: number;
  readonly depasse: boolean;
  readonly debutJournee: string;
}

export function debutJourneeUtc(maintenant: Date = new Date()): string {
  const jour = new Date(
    Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()),
  );
  return jour.toISOString();
}

export async function etatBudget(client: Client, profilId: string): Promise<EtatBudget> {
  const debut = debutJourneeUtc();

  const [{ data: profil }, { data: appels }] = await Promise.all([
    client.from('profils').select('plafond_cout_quotidien_usd').eq('id', profilId).maybeSingle(),
    client.from('appels_llm').select('cout_usd').eq('profil_id', profilId).gte('cree_le', debut),
  ]);

  const plafondUsd = Number(profil?.plafond_cout_quotidien_usd ?? 0);
  const depenseUsd = (appels ?? []).reduce((total, ligne) => total + Number(ligne.cout_usd), 0);

  return {
    plafondUsd,
    depenseUsd,
    restantUsd: Math.max(0, plafondUsd - depenseUsd),
    depasse: depenseUsd >= plafondUsd,
    debutJournee: debut,
  };
}

/**
 * Réserve de sécurité avant le plafond.
 *
 * Le coût d'un appel n'est connu qu'après coup : si l'on n'arrêtait qu'au
 * plafond exact, le dernier appel le dépasserait toujours un peu. On coupe
 * donc quand il reste moins que cette marge, quitte à sous-utiliser le budget.
 */
export const MARGE_SECURITE_USD = 0.05;

export function budgetSuffisant(budget: EtatBudget): boolean {
  return budget.restantUsd > MARGE_SECURITE_USD;
}
