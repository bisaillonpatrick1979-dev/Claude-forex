'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  OUTILS,
  POINTS_REQUIS,
  type Annotation,
  type Outil,
  type PointGraphique,
} from '@/lib/graphique/annotations';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Enregistrement des traits posés sur le graphique.
 *
 * L'écriture passe par le client authentifié, donc par RLS : un profil ne peut
 * annoter que ses propres graphiques, et l'action ne prend pas d'identifiant de
 * profil — il vient de la session, jamais du navigateur.
 *
 * La validation d'arité est faite ici **et** par une contrainte CHECK en base.
 * Ce n'est pas de la ceinture-bretelles gratuite : un Fibonacci à un seul point
 * produirait un tracé vide à l'écran et une phrase « incomplet » dans
 * l'instantané des agents. Autant le refuser des deux côtés, avec un message
 * lisible du côté qu'on contrôle.
 */

const pointSchema = z.object({
  horodatage: z.number().int().positive(),
  prix: z.number().finite(),
});

const schema = z.object({
  symbole: z.string().min(1).max(20),
  intervalle: z.string().max(8).nullable(),
  outil: z.enum(OUTILS),
  points: z.array(pointSchema).min(1).max(2),
  couleur: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide.'),
  libelle: z.string().trim().max(120).nullable(),
});

export interface ResultatAnnotation {
  readonly ok: boolean;
  readonly message?: string;
  readonly annotation?: Annotation;
}

export async function creerAnnotation(saisie: unknown): Promise<ResultatAnnotation> {
  const analyse = schema.safeParse(saisie);
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Saisie invalide.' };
  }
  const donnees = analyse.data;

  const attendus = POINTS_REQUIS[donnees.outil];
  if (donnees.points.length !== attendus) {
    return {
      ok: false,
      message: `${donnees.outil} demande ${attendus} point(s), ${donnees.points.length} fourni(s).`,
    };
  }

  const supabase = await clientServeur();
  const { data: session } = await supabase.auth.getClaims();
  const profilId = session?.claims?.sub;
  if (typeof profilId !== 'string') return { ok: false, message: 'Session expirée.' };

  const { data, error } = await supabase
    .from('annotations_graphique')
    .insert({
      profil_id: profilId,
      symbole: donnees.symbole,
      intervalle: donnees.intervalle,
      outil: donnees.outil,
      points: donnees.points,
      couleur: donnees.couleur,
      libelle: donnees.libelle || null,
    })
    .select('id, symbole, intervalle, outil, points, couleur, libelle')
    .single();

  if (error) return { ok: false, message: error.message };

  revalidatePath('/salle-des-marches');
  return { ok: true, annotation: versAnnotation(data) };
}

export async function supprimerAnnotation(id: string): Promise<ResultatAnnotation> {
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: 'Identifiant invalide.' };
  }

  const supabase = await clientServeur();
  // Pas de filtre sur le profil : RLS s'en charge, et l'ajouter ici laisserait
  // croire que c'est lui qui protège.
  const { error } = await supabase.from('annotations_graphique').delete().eq('id', id);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/salle-des-marches');
  return { ok: true };
}

export async function renommerAnnotation(
  id: string,
  libelle: string,
): Promise<ResultatAnnotation> {
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: 'Identifiant invalide.' };
  }
  const propre = libelle.trim().slice(0, 120);

  const supabase = await clientServeur();
  const { error } = await supabase
    .from('annotations_graphique')
    .update({ libelle: propre || null, maj_le: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/salle-des-marches');
  return { ok: true };
}

export async function listerAnnotations(symbole: string): Promise<readonly Annotation[]> {
  const supabase = await clientServeur();
  const { data } = await supabase
    .from('annotations_graphique')
    .select('id, symbole, intervalle, outil, points, couleur, libelle')
    .eq('symbole', symbole)
    .order('cree_le', { ascending: true });

  return (data ?? []).map(versAnnotation);
}

interface LigneAnnotation {
  id: string;
  symbole: string;
  intervalle: string | null;
  outil: string;
  points: unknown;
  couleur: string;
  libelle: string | null;
}

/**
 * Le JSON de `points` est typé `unknown` par le client : il vient d'une colonne
 * jsonb, que rien n'oblige à contenir ce qu'on croit. On le revalide plutôt que
 * de le transtyper — une ligne écrite à la main en base ne doit pas pouvoir
 * faire planter le rendu.
 */
function versAnnotation(ligne: LigneAnnotation): Annotation {
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
}
