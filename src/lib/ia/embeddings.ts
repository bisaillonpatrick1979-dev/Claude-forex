import type { SupabaseClient } from '@supabase/supabase-js';

import { lireCle } from '@/lib/marche/cles';
import type { Database } from '@/types/base-de-donnees';

import { embeddingOpenAI } from './openai';

type Client = SupabaseClient<Database>;

export const DIMENSION = 1536;

/**
 * Deux méthodes d'embedding, jamais mélangées.
 *
 * `openai-3-small` est sémantique : « le stop était trop serré » et « j'ai été
 * sorti sur le bruit » se ressemblent. Elle exige une clé OpenAI.
 *
 * `lexical-1536` est une projection lexicale calculée ici, sans réseau ni
 * coût. Elle rapproche les textes qui partagent des mots, pas des idées. C'est
 * nettement moins bon, mais la mémoire fonctionne quand même dès le premier
 * jour, sans clé — et l'interface annonce laquelle est active plutôt que de
 * laisser croire à une recherche sémantique.
 *
 * Les deux espaces vectoriels n'ont rien de commun : comparer une distance
 * cosinus de l'un à l'autre produirait un classement arbitraire présenté comme
 * pertinent. La méthode est donc stockée avec chaque vecteur et les fonctions
 * de recherche filtrent dessus.
 */
export type MethodeEmbedding = 'openai-3-small' | 'lexical-1536';

export interface Embedding {
  readonly vecteur: readonly number[];
  readonly methode: MethodeEmbedding;
}

/** Découpage volontairement simple : lettres accentuées conservées, chiffres
 *  écartés — un niveau de prix n'a rien à faire dans un index lexical. */
function jetons(texte: string): readonly string[] {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter((jeton) => jeton.length >= 3);
}

function hacher(jeton: string, sel: number): number {
  let valeur = 0x811c9dc5 ^ sel;
  for (let index = 0; index < jeton.length; index += 1) {
    valeur ^= jeton.charCodeAt(index);
    valeur = Math.imul(valeur, 0x01000193) >>> 0;
  }
  return valeur;
}

/**
 * Projection lexicale déterministe (« hashing trick »).
 *
 * Chaque jeton est projeté sur deux dimensions avec des signes opposés : deux
 * jetons différents qui tombent sur la même case ne s'additionnent alors pas
 * systématiquement, ce qui limite le bruit des collisions. Le vecteur est
 * normalisé pour que la distance cosinus reste comparable d'un texte à l'autre.
 */
export function embeddingLexical(texte: string): readonly number[] {
  const vecteur = new Array<number>(DIMENSION).fill(0);
  const mots = jetons(texte);
  if (mots.length === 0) return vecteur;

  for (const mot of mots) {
    const positionA = hacher(mot, 0) % DIMENSION;
    const positionB = hacher(mot, 0x9e3779b9) % DIMENSION;
    vecteur[positionA] = (vecteur[positionA] ?? 0) + 1;
    vecteur[positionB] = (vecteur[positionB] ?? 0) - 1;
  }

  const norme = Math.sqrt(vecteur.reduce((total, valeur) => total + valeur * valeur, 0));
  if (norme === 0) return vecteur;
  return vecteur.map((valeur) => valeur / norme);
}

/** Méthode qui sera utilisée pour ce profil, sans rien calculer. */
export async function methodeActive(
  client: Client,
  profilId: string,
): Promise<MethodeEmbedding> {
  const cle = await lireCle(client, profilId, 'openai');
  return cle ? 'openai-3-small' : 'lexical-1536';
}

/**
 * Calcule un embedding avec la meilleure méthode disponible.
 *
 * En cas d'échec OpenAI on ne bascule pas silencieusement sur le lexical : le
 * vecteur serait rangé dans le mauvais espace et pollierait durablement
 * l'index. On remonte l'erreur, l'appelant décide.
 */
export async function calculerEmbedding(
  client: Client,
  profilId: string,
  texte: string,
  signal?: AbortSignal,
): Promise<Embedding> {
  const cle = await lireCle(client, profilId, 'openai');

  if (!cle) {
    return { vecteur: embeddingLexical(texte), methode: 'lexical-1536' };
  }

  const { vecteur, tokens } = await embeddingOpenAI(cle, texte, 'text-embedding-3-small', signal);

  if (vecteur.length !== DIMENSION) {
    throw new Error(
      `Embedding OpenAI de dimension ${vecteur.length}, ${DIMENSION} attendue par le schéma.`,
    );
  }

  // Les embeddings sont facturés : ils comptent dans le plafond quotidien au
  // même titre qu'un appel de conversation.
  await client.from('appels_llm').insert({
    profil_id: profilId,
    fournisseur: 'openai',
    modele: 'text-embedding-3-small',
    tokens_entree: tokens,
    tokens_sortie: 0,
    cout_usd: (tokens * 0.02) / 1_000_000,
    succes: true,
  });

  return { vecteur, methode: 'openai-3-small' };
}

/** pgvector accepte le littéral texte « [0.1,0.2,…] » à l'insertion. */
export function versLitteral(vecteur: readonly number[]): string {
  return `[${vecteur.map((valeur) => valeur.toFixed(6)).join(',')}]`;
}
