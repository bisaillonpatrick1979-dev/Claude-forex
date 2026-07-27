import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import { blocEvenements } from './evaluation';

type Client = SupabaseClient<Database>;

/**
 * Franchissements à remettre aux agents.
 *
 * `consomme_par_agents` est marqué **après** lecture, dans la même passe. Sans
 * ce drapeau, chaque cycle relirait les mêmes franchissements et raisonnerait
 * en boucle sur un mouvement déjà digéré — l'agent verrait « le niveau vient
 * d'être franchi » trois heures après, à chaque délibération.
 *
 * Le marquage est fait même quand le cycle échoue plus loin. C'est un choix :
 * un événement relu indéfiniment est plus nuisible qu'un événement manqué une
 * fois, puisqu'il fausse le raisonnement de tous les cycles suivants. Le
 * franchissement reste consultable dans l'interface, il ne disparaît pas.
 */
export async function consommerFranchissements(
  client: Client,
  profilId: string,
  symbole: string,
  decimales: number,
  fuseau: string,
): Promise<string> {
  const { data } = await client
    .from('evenements_alerte')
    .select('id, symbole, niveau, prix, direction, libelle_annotation, declenche_le')
    .eq('profil_id', profilId)
    .eq('symbole', symbole)
    .eq('consomme_par_agents', false)
    .order('declenche_le', { ascending: true })
    .limit(20);

  if (!data || data.length === 0) return '';

  const bloc = blocEvenements(
    data.map((ligne) => ({
      symbole: ligne.symbole,
      niveau: Number(ligne.niveau),
      prix: Number(ligne.prix),
      direction: ligne.direction,
      libelleAnnotation: ligne.libelle_annotation,
      // Heure locale du profil : un agent qui lit « 02 h 14 » pour un
      // franchissement survenu à 20 h 14 chez le trader situe mal l'événement
      // dans la séance.
      declencheLe: new Intl.DateTimeFormat('fr-CA', {
        timeZone: fuseau,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(ligne.declenche_le)),
    })),
    decimales,
  );

  await client
    .from('evenements_alerte')
    .update({ consomme_par_agents: true })
    .in(
      'id',
      data.map((ligne) => ligne.id),
    );

  return bloc;
}
