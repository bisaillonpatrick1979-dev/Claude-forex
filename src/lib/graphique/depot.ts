import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '@/types/base-de-donnees';

import { annotationVisible, type Annotation, type Outil, type PointGraphique } from './annotations';

type Client = SupabaseClient<Database>;

/**
 * Lecture serveur des annotations, pour les remettre aux agents.
 *
 * Le filtre par unité de temps est appliqué ici et non en SQL : c'est la même
 * fonction que celle du rendu, donc l'agent voit exactement ce que le trader
 * voit à l'écran. Deux filtres écrits séparément finiraient par diverger, et la
 * divergence serait invisible — l'agent raisonnerait sur des traits que
 * personne n'a sous les yeux.
 */

const pointSchema = z.object({
  horodatage: z.number().int().positive(),
  prix: z.number().finite(),
});

export async function lireAnnotations(
  client: Client,
  profilId: string,
  symbole: string,
  intervalle: string,
): Promise<readonly Annotation[]> {
  const { data } = await client
    .from('annotations_graphique')
    .select('id, symbole, intervalle, outil, points, couleur, libelle')
    .eq('profil_id', profilId)
    .eq('symbole', symbole)
    .order('cree_le', { ascending: true });

  return (data ?? [])
    .map((ligne) => {
      const points = z.array(pointSchema).safeParse(ligne.points);
      return {
        id: ligne.id,
        symbole: ligne.symbole,
        intervalle: ligne.intervalle,
        outil: ligne.outil as Outil,
        points: points.success ? (points.data as PointGraphique[]) : [],
        couleur: ligne.couleur,
        libelle: ligne.libelle,
      };
    })
    // Un tracé dont les points n'ont pas survécu à la relecture ne décrit rien :
    // le remettre aux agents produirait « incomplet », c'est-à-dire du bruit.
    .filter((annotation) => annotation.points.length > 0)
    .filter((annotation) => annotationVisible(annotation, symbole, intervalle));
}
