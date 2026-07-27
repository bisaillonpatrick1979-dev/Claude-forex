import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

type Client = SupabaseClient<Database>;

/**
 * Arrêt effectif de la délibération.
 *
 * Le kill switch gelait le portefeuille et annonçait « agents arrêtés, ordres
 * en attente annulés, portefeuille gelé ». La deuxième moitié était vraie : un
 * portefeuille gelé fait refuser toute création d'ordre par les garde-fous. La
 * première ne l'était pas. Rien ne consultait `gele` avant de lancer un cycle :
 * les agents continuaient d'analyser, de débattre et de **facturer**, pour
 * produire des propositions qu'une barrière plus loin rejetait toutes.
 *
 * C'est la pire forme de panne — un bouton d'arrêt d'urgence qui affiche
 * « arrêté » sans arrêter. On le rend vrai ici, au seul endroit qui compte :
 * avant la dépense, pas après.
 *
 * Le point d'entrée est volontairement en base et non dans un état de
 * navigateur. La veille tourne dans un onglet ; si l'arrêt vivait au même
 * endroit, il ne servirait à rien depuis un autre appareil — précisément la
 * situation où on en a besoin.
 */

export interface EtatArret {
  readonly gele: boolean;
  readonly raison: string | null;
}

export async function etatArret(client: Client, profilId: string): Promise<EtatArret> {
  const { data } = await client
    .from('portefeuilles')
    .select('gele')
    .eq('profil_id', profilId)
    .maybeSingle();

  // Absence de portefeuille : on considère la firme arrêtée. Un défaut fermé
  // vaut mieux qu'une délibération lancée sur un compte introuvable.
  if (!data) {
    return { gele: true, raison: 'Aucun portefeuille pour ce profil : rien à faire délibérer.' };
  }

  return {
    gele: data.gele,
    raison: data.gele
      ? 'Portefeuille gelé (kill switch) : les agents ne délibèrent pas. ' +
        'Le dégel se fait depuis la salle des marchés, sur action explicite.'
      : null,
  };
}
