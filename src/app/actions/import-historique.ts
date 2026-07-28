'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { estIntervalle } from '@/lib/marche/intervalles';
import { FOURNISSEUR_IMPORT } from '@/lib/marche/types';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Écriture en base des bougies importées d'un fichier.
 *
 * L'analyse du fichier se fait dans le navigateur, pas ici : quinze ans de M5
 * représentent plus d'un million de lignes et des dizaines de mégaoctets, bien
 * au-delà de ce qu'une action serveur accepte en une fois. Le navigateur
 * découpe donc en tranches, et cette action n'écrit que des bougies déjà
 * validées.
 *
 * Conséquence à assumer : la validation vit côté client, donc elle est
 * contournable. C'est acceptable ici parce qu'un import ne touche qu'aux
 * données du profil qui l'envoie — il ne fait pas passer d'ordre et ne dépense
 * rien. Le contrôle de cohérence est refait à l'écriture pour les bornes
 * indiscutables, mais sans prétendre remplacer l'analyse complète.
 *
 * Le `fournisseur_code` vaut `import` : ni `mock` — ce ne sont pas des bougies
 * inventées — ni le nom d'un fournisseur en ligne, dont on n'a pas constaté la
 * réponse. La provenance reste lisible dans l'écran de backtest, et
 * `natureFournisseur` les traite comme du réel.
 */

const bougieSchema = z.object({
  horodatage: z.number().int().positive(),
  ouverture: z.number().positive(),
  haut: z.number().positive(),
  bas: z.number().positive(),
  cloture: z.number().positive(),
  volume: z.number().nullable(),
});

const schema = z.object({
  symbole: z.string().min(1).max(20),
  intervalle: z.string().refine(estIntervalle, 'Intervalle inconnu.'),
  // Une tranche par appel. 5 000 lignes tiennent largement dans la limite de
  // taille d'une action serveur, et laissent de la marge à l'encodage JSON.
  bougies: z.array(bougieSchema).min(1).max(5000),
});

export interface ResultatEcriture {
  readonly ok: boolean;
  readonly message: string;
  readonly ecrites?: number;
}

export async function ecrireTrancheImportee(saisie: unknown): Promise<ResultatEcriture> {
  const analyse = schema.safeParse(saisie);
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Tranche invalide.' };
  }
  const donnees = analyse.data;

  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY absente côté serveur.' };

  const { data: symbole } = await client
    .from('symboles')
    .select('id')
    .eq('code', donnees.symbole)
    .maybeSingle();

  if (!symbole) return { ok: false, message: `Instrument ${donnees.symbole} inconnu.` };

  // Dernier filet, sur les seules règles qui ne demandent aucune interprétation.
  const coherentes = donnees.bougies.filter(
    (bougie) =>
      bougie.haut >= bougie.bas &&
      bougie.haut >= Math.max(bougie.ouverture, bougie.cloture) &&
      bougie.bas <= Math.min(bougie.ouverture, bougie.cloture),
  );

  if (coherentes.length === 0) {
    return { ok: false, message: 'Aucune bougie cohérente dans cette tranche.' };
  }

  const maintenant = new Date().toISOString();
  const lignes = coherentes.map((bougie) => ({
    symbole_id: symbole.id,
    intervalle: donnees.intervalle,
    horodatage: new Date(bougie.horodatage * 1000).toISOString(),
    ouverture: bougie.ouverture,
    haut: bougie.haut,
    bas: bougie.bas,
    cloture: bougie.cloture,
    volume: bougie.volume,
    fournisseur_code: FOURNISSEUR_IMPORT,
    // Une bougie importée est close par définition : elle appartient au passé.
    fermee: true,
    recupere_le: maintenant,
    // Jamais périmée : c'est de l'historique, il ne se rafraîchit pas. Lui
    // donner une date d'expiration ferait rappeler le fournisseur pour
    // remplacer des données déjà définitives.
    perime_le: new Date('2099-12-31T00:00:00Z').toISOString(),
  }));

  const { error } = await client
    .from('chandeliers')
    .upsert(lignes, { onConflict: 'symbole_id,intervalle,horodatage' });

  if (error) return { ok: false, message: error.message };

  revalidatePath('/backtest');
  revalidatePath('/salle-des-marches');
  return { ok: true, message: `${lignes.length} bougie(s) écrite(s).`, ecrites: lignes.length };
}

/** Ce qui est déjà en base pour ce couple, afin d'annoncer ce que l'import ajoute. */
export async function etatHistorique(
  symbole: string,
  intervalle: string,
): Promise<{ bougies: number; debut: string | null; fin: string | null }> {
  if (!estIntervalle(intervalle)) return { bougies: 0, debut: null, fin: null };

  const client = clientAdminOptionnel();
  if (!client) return { bougies: 0, debut: null, fin: null };

  const { data: ligne } = await client
    .from('symboles')
    .select('id')
    .eq('code', symbole)
    .maybeSingle();
  if (!ligne) return { bougies: 0, debut: null, fin: null };

  const { count } = await client
    .from('chandeliers')
    .select('horodatage', { count: 'exact', head: true })
    .eq('symbole_id', ligne.id)
    .eq('intervalle', intervalle);

  const { data: bornes } = await client
    .from('chandeliers')
    .select('horodatage')
    .eq('symbole_id', ligne.id)
    .eq('intervalle', intervalle)
    .order('horodatage', { ascending: true })
    .limit(1);

  const { data: derniere } = await client
    .from('chandeliers')
    .select('horodatage')
    .eq('symbole_id', ligne.id)
    .eq('intervalle', intervalle)
    .order('horodatage', { ascending: false })
    .limit(1);

  return {
    bougies: count ?? 0,
    debut: bornes?.[0]?.horodatage ?? null,
    fin: derniere?.[0]?.horodatage ?? null,
  };
}
