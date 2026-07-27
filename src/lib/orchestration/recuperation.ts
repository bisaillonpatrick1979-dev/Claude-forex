import type { SupabaseClient } from '@supabase/supabase-js';

import { calculerEmbedding, versLitteral } from '@/lib/ia/embeddings';
import type { Database } from '@/types/base-de-donnees';

type Client = SupabaseClient<Database>;

/**
 * Récupération de mémoire : playbooks de stratégie et leçons passées.
 *
 * Rien de ce qui est récupéré ici n'est présenté à l'agent comme une vérité :
 * ce sont des extraits, avec leur distance, que l'agent peut écarter. Une
 * mémoire vectorielle rapporte parfois un élément hors sujet ; le prompt le dit
 * explicitement plutôt que de faire semblant que le tri est parfait.
 *
 * En cas d'échec de la recherche (embedding indisponible, index vide), on rend
 * une liste vide et le cycle continue. Une mémoire absente dégrade la qualité,
 * elle ne doit pas empêcher la firme de travailler.
 */

export interface ExtraitStrategie {
  readonly code: string;
  readonly nom: string;
  readonly famille: string;
  readonly rendu: string;
  readonly distance: number;
}

export interface ExtraitLecon {
  readonly titre: string;
  readonly rendu: string;
  readonly distance: number;
}

export async function recupererStrategies(
  client: Client,
  profilId: string,
  requete: string,
  famille: string | null,
  limite = 2,
): Promise<readonly ExtraitStrategie[]> {
  try {
    const { vecteur, methode } = await calculerEmbedding(client, profilId, requete);
    const { data } = await client.rpc('rechercher_strategies', {
      p_embedding: versLitteral(vecteur),
      p_methode: methode,
      p_famille: famille ?? undefined,
      p_limite: limite,
      // L'orchestrateur parle avec la clé de service : auth.uid() y est NULL,
      // il faut donc nommer le profil explicitement.
      p_profil_id: profilId,
    });

    return (data ?? []).map((ligne) => ({
      code: ligne.code,
      nom: ligne.nom,
      famille: ligne.famille,
      distance: ligne.distance,
      rendu: [
        `[${ligne.code}] ${ligne.nom} (${ligne.famille})`,
        `Résumé : ${ligne.resume}`,
        `S’applique quand : ${ligne.conditions_marche}`,
        `Entrée : ${ligne.regles_entree}`,
        `Sortie : ${ligne.regles_sortie}`,
        `Taille : ${ligne.gestion_taille}`,
        `Échoue quand : ${ligne.cas_echec}`,
      ].join('\n'),
    }));
  } catch {
    return [];
  }
}

export async function recupererLecons(
  client: Client,
  profilId: string,
  requete: string,
  symboleId: string | null,
  limite = 3,
): Promise<readonly ExtraitLecon[]> {
  try {
    const { vecteur, methode } = await calculerEmbedding(client, profilId, requete);
    const { data } = await client.rpc('rechercher_lecons', {
      p_embedding: versLitteral(vecteur),
      p_methode: methode,
      p_symbole_id: symboleId ?? undefined,
      p_limite: limite,
      p_profil_id: profilId,
    });

    return (data ?? []).map((ligne) => ({
      titre: ligne.titre,
      distance: ligne.distance,
      rendu: [
        `« ${ligne.titre} »`,
        ligne.contenu,
        ligne.resultat_pnl === null
          ? 'Résultat de la position : donnée manquante.'
          : `Résultat de la position : ${Number(ligne.resultat_pnl).toFixed(2)}.`,
      ].join('\n'),
    }));
  } catch {
    return [];
  }
}
