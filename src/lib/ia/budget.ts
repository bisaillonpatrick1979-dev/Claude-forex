import type { SupabaseClient } from '@supabase/supabase-js';

import { debutJourneeIso, FUSEAU_DEFAUT, libelleFuseau } from '@/lib/temps/journee';
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
 * La journée est celle du fuseau du profil, pas celle de l'UTC. Le détail
 * compte : depuis l'Alberta, une journée UTC se réarme à 18 h locales, en
 * pleine séance de New York. Le plafond aurait doublé les jours où la firme
 * travaille le soir, et se serait coupé en deux les autres — sans que rien ne
 * l'explique à l'écran.
 */

export interface EtatBudget {
  readonly plafondUsd: number;
  readonly depenseUsd: number;
  readonly restantUsd: number;
  readonly depasse: boolean;
  readonly debutJournee: string;
  readonly fuseau: string;
  /** Fuseau et décalage en clair, à afficher à côté du compteur. */
  readonly libelleFuseau: string;
}

export async function etatBudget(client: Client, profilId: string): Promise<EtatBudget> {
  // Le fuseau doit être lu avant de pouvoir borner la journée : les deux
  // requêtes ne peuvent donc pas partir ensemble.
  const { data: profil } = await client
    .from('profils')
    .select('plafond_cout_quotidien_usd, fuseau_horaire')
    .eq('id', profilId)
    .maybeSingle();

  const fuseau = profil?.fuseau_horaire ?? FUSEAU_DEFAUT;
  const debut = debutJourneeIso(fuseau);

  const { data: appels } = await client
    .from('appels_llm')
    .select('cout_usd')
    .eq('profil_id', profilId)
    .gte('cree_le', debut);

  const plafondUsd = Number(profil?.plafond_cout_quotidien_usd ?? 0);
  const depenseUsd = (appels ?? []).reduce((total, ligne) => total + Number(ligne.cout_usd), 0);

  return {
    plafondUsd,
    depenseUsd,
    restantUsd: Math.max(0, plafondUsd - depenseUsd),
    depasse: depenseUsd >= plafondUsd,
    debutJournee: debut,
    fuseau,
    libelleFuseau: libelleFuseau(fuseau),
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
