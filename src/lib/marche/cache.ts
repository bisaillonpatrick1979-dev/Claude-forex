import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import { bougieFermee, ttlSecondes } from './intervalles';
import { natureFournisseur, type Chandelier, type CodeFournisseur, type Intervalle } from './types';

type Client = SupabaseClient<Database>;

/**
 * Cache de chandeliers dans Supabase.
 *
 * Deux règles gouvernent la fraîcheur :
 *   1. une bougie **fermée** est définitive — on ne la redemande jamais, quel
 *      que soit son âge ;
 *   2. la bougie **en formation** a un TTL par intervalle (M1 : 60 s, H1 :
 *      5 min, D1 : 12 h).
 *
 * Le cache ne ment jamais sur son âge : `lireCache` rend aussi la fraîcheur,
 * et le routeur peut décider de servir du périmé en le marquant comme tel.
 */

export interface LectureCache {
  readonly chandeliers: readonly Chandelier[];
  /** Vrai si la dernière bougie est encore dans son TTL. */
  readonly frais: boolean;
  readonly fournisseur: CodeFournisseur | null;
  readonly recupereLe: number | null;
}

export async function lireCache(
  client: Client,
  symboleId: string,
  intervalle: Intervalle,
  limite: number,
  maintenant: number = Math.floor(Date.now() / 1000),
): Promise<LectureCache> {
  const { data } = await client
    .from('chandeliers')
    .select('horodatage, ouverture, haut, bas, cloture, volume, fournisseur_code, recupere_le, fermee')
    .eq('symbole_id', symboleId)
    .eq('intervalle', intervalle)
    .order('horodatage', { ascending: false })
    .limit(limite);

  if (!data || data.length === 0) {
    return { chandeliers: [], frais: false, fournisseur: null, recupereLe: null };
  }

  // La bougie la plus récente donne la nature de la série ; celles d'une autre
  // nature sont écartées. Une série tronquée fait redemander le fournisseur —
  // très préférable à une série continue en apparence dont la moitié est
  // inventée. Cas vécu : XAU/USD passait de 2 379 à 4 056 en une bougie, à la
  // jointure exacte entre la simulation et les premières données réelles.
  const nature = natureFournisseur(data[0]!.fournisseur_code as CodeFournisseur);
  const homogenes = data.filter(
    (ligne) => natureFournisseur(ligne.fournisseur_code as CodeFournisseur) === nature,
  );

  const chandeliers = homogenes
    .map((ligne) => ({
      horodatage: Math.floor(new Date(ligne.horodatage).getTime() / 1000),
      ouverture: Number(ligne.ouverture),
      haut: Number(ligne.haut),
      bas: Number(ligne.bas),
      cloture: Number(ligne.cloture),
      volume: ligne.volume === null ? null : Number(ligne.volume),
    }))
    .sort((a, b) => a.horodatage - b.horodatage);

  const plusRecente = homogenes[0];
  const recupereLe = plusRecente
    ? Math.floor(new Date(plusRecente.recupere_le).getTime() / 1000)
    : null;

  const derniereBougie = chandeliers[chandeliers.length - 1];
  const ageSecondes = recupereLe === null ? Number.POSITIVE_INFINITY : maintenant - recupereLe;

  // Si la dernière bougie stockée est déjà close et que la bougie en cours a
  // commencé depuis, le cache est incomplet même s'il est récent.
  const couvreLaBougieCourante =
    derniereBougie !== undefined && !bougieFermee(derniereBougie.horodatage, intervalle, maintenant);

  const frais = ageSecondes <= ttlSecondes(intervalle) && couvreLaBougieCourante;

  return {
    chandeliers,
    frais,
    fournisseur: (plusRecente?.fournisseur_code as CodeFournisseur | undefined) ?? null,
    recupereLe,
  };
}

/**
 * Écrit les bougies reçues. `upsert` sur la clé naturelle (symbole,
 * intervalle, horodatage) : réécrire une bougie en formation est normal,
 * dupliquer ne l'est pas.
 *
 * Nécessite un client à privilèges — la table est en lecture seule pour le
 * navigateur.
 */
export async function ecrireCache(
  client: Client,
  symboleId: string,
  intervalle: Intervalle,
  fournisseurCode: CodeFournisseur,
  chandeliers: readonly Chandelier[],
  maintenant: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  if (chandeliers.length === 0) return;

  const lignes = chandeliers.map((chandelier) => ({
    symbole_id: symboleId,
    intervalle,
    horodatage: new Date(chandelier.horodatage * 1000).toISOString(),
    ouverture: chandelier.ouverture,
    haut: chandelier.haut,
    bas: chandelier.bas,
    cloture: chandelier.cloture,
    volume: chandelier.volume,
    fournisseur_code: fournisseurCode,
    fermee: bougieFermee(chandelier.horodatage, intervalle, maintenant),
    recupere_le: new Date(maintenant * 1000).toISOString(),
    perime_le: new Date((maintenant + ttlSecondes(intervalle)) * 1000).toISOString(),
  }));

  await client
    .from('chandeliers')
    .upsert(lignes, { onConflict: 'symbole_id,intervalle,horodatage' });
}
