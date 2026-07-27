'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { DIRECTIONS, zoneMorteSuggeree } from '@/lib/alertes/evaluation';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Armement des alertes de niveau.
 *
 * Le libellé du tracé est **recopié** dans l'alerte plutôt que joint. Ce n'est
 * pas une dénormalisation par paresse : un message de franchissement doit rester
 * lisible même si le tracé d'origine a été effacé entre-temps. « EUR/USD a
 * franchi “Résistance hebdo” » garde son sens ; « EUR/USD a franchi le niveau
 * d'un tracé supprimé » n'en a aucun.
 */

const schema = z.object({
  symbole: z.string().min(1).max(20),
  niveau: z.number().finite(),
  direction: z.enum(DIRECTIONS),
  zoneMorte: z.number().min(0).optional(),
  usageUnique: z.boolean().optional(),
  annotationId: z.uuid().nullable().optional(),
  libelleAnnotation: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(280).nullable().optional(),
});

export interface ResultatAlerte {
  readonly ok: boolean;
  readonly message?: string;
}

export async function armerAlerte(saisie: unknown): Promise<ResultatAlerte> {
  const analyse = schema.safeParse(saisie);
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Saisie invalide.' };
  }
  const donnees = analyse.data;

  const supabase = await clientServeur();
  const { data: session } = await supabase.auth.getClaims();
  const profilId = session?.claims?.sub;
  if (typeof profilId !== 'string') return { ok: false, message: 'Session expirée.' };

  const { error } = await supabase.from('alertes_prix').insert({
    profil_id: profilId,
    symbole: donnees.symbole,
    niveau: donnees.niveau,
    direction: donnees.direction,
    zone_morte: donnees.zoneMorte ?? zoneMorteSuggeree(donnees.niveau),
    usage_unique: donnees.usageUnique ?? true,
    annotation_id: donnees.annotationId ?? null,
    libelle_annotation: donnees.libelleAnnotation ?? null,
    note: donnees.note ?? null,
    // `dernier_cote` reste NULL : la première observation ne fait
    // qu'enregistrer le point de départ, sans rien déclencher.
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath('/salle-des-marches');
  return { ok: true, message: 'Alerte armée. Première observation dans les cinq minutes.' };
}

export async function desarmerAlerte(id: string): Promise<ResultatAlerte> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: 'Identifiant invalide.' };

  const supabase = await clientServeur();
  const { error } = await supabase.from('alertes_prix').delete().eq('id', id);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/salle-des-marches');
  return { ok: true };
}

export interface AlerteAffichee {
  readonly id: string;
  readonly symbole: string;
  readonly niveau: number;
  readonly direction: string;
  readonly libelleAnnotation: string | null;
  readonly derniereCote: string | null;
  readonly dernierPrix: number | null;
  readonly verifieLe: string | null;
  readonly active: boolean;
}

export async function listerAlertes(symbole: string): Promise<readonly AlerteAffichee[]> {
  const supabase = await clientServeur();
  const { data } = await supabase
    .from('alertes_prix')
    .select(
      'id, symbole, niveau, direction, libelle_annotation, dernier_cote, dernier_prix, verifie_le, active',
    )
    .eq('symbole', symbole)
    .order('cree_le', { ascending: false });

  return (data ?? []).map((ligne) => ({
    id: ligne.id,
    symbole: ligne.symbole,
    niveau: Number(ligne.niveau),
    direction: ligne.direction,
    libelleAnnotation: ligne.libelle_annotation,
    derniereCote: ligne.dernier_cote,
    dernierPrix: ligne.dernier_prix === null ? null : Number(ligne.dernier_prix),
    verifieLe: ligne.verifie_le,
    active: ligne.active,
  }));
}

export interface EvenementAffiche {
  readonly id: string;
  readonly symbole: string;
  readonly niveau: number;
  readonly prix: number;
  readonly direction: string;
  readonly libelleAnnotation: string | null;
  readonly declencheLe: string;
}

/** Franchissements récents, tous symboles confondus. */
export async function listerEvenements(limite = 20): Promise<readonly EvenementAffiche[]> {
  const supabase = await clientServeur();
  const { data } = await supabase
    .from('evenements_alerte')
    .select('id, symbole, niveau, prix, direction, libelle_annotation, declenche_le')
    .order('declenche_le', { ascending: false })
    .limit(limite);

  return (data ?? []).map((ligne) => ({
    id: ligne.id,
    symbole: ligne.symbole,
    niveau: Number(ligne.niveau),
    prix: Number(ligne.prix),
    direction: ligne.direction,
    libelleAnnotation: ligne.libelle_annotation,
    declencheLe: ligne.declenche_le,
  }));
}
