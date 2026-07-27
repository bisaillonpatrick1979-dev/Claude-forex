import type { Horizon } from '@/lib/agents/horizons';
import type { SupabaseClient } from '@supabase/supabase-js';

import { calculerEmbedding, versLitteral, type MethodeEmbedding } from '@/lib/ia/embeddings';
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

/**
 * Indexe les playbooks qui n'ont pas encore d'embedding dans la méthode
 * courante.
 *
 * Les six playbooks livrés arrivent sans vecteur : leur contenu est fixe, mais
 * la méthode d'embedding dépend du profil (clé OpenAI ou non), donc elle ne
 * peut pas être calculée dans une migration. On le fait au premier cycle, une
 * fois, plutôt que d'exiger une action manuelle que personne ne pensera à
 * lancer — et plutôt que de laisser la mémoire silencieusement vide.
 *
 * Un échec ici ne fait pas échouer le cycle : la firme travaille sans
 * playbooks, moins bien, et le dira.
 */
export async function indexerStrategiesManquantes(
  client: Client,
  profilId: string,
  methode: MethodeEmbedding,
  maximum = 8,
): Promise<number> {
  const { data } = await client
    .from('strategies')
    .select('id, code, nom, famille, resume, conditions_marche, regles_entree, regles_sortie, gestion_taille, cas_echec')
    .or(`profil_id.is.null,profil_id.eq.${profilId}`)
    .eq('actif', true)
    .or(`methode_embedding.is.null,methode_embedding.neq.${methode}`)
    .limit(maximum);

  if (!data || data.length === 0) return 0;

  let indexees = 0;
  for (const strategie of data) {
    // Le texte indexé est celui qui décrit *quand* la stratégie s'applique :
    // c'est ce qu'on cherchera à rapprocher d'un instantané de marché, pas le
    // nom du playbook.
    const texte = [
      strategie.nom,
      strategie.famille,
      strategie.resume,
      strategie.conditions_marche,
      strategie.regles_entree,
      strategie.regles_sortie,
    ].join('\n');

    try {
      const embedding = await calculerEmbedding(client, profilId, texte);
      if (embedding.methode !== methode) continue;

      await client
        .from('strategies')
        .update({
          embedding: versLitteral(embedding.vecteur),
          methode_embedding: embedding.methode,
        })
        .eq('id', strategie.id);

      indexees += 1;
    } catch {
      // Une clé refusée ou un quota épuisé arrête l'indexation : insister
      // enchaînerait des appels facturés voués à échouer.
      break;
    }
  }

  return indexees;
}

export async function recupererStrategies(
  client: Client,
  profilId: string,
  requete: string,
  famille: string | null,
  limite = 2,
  horizon: Horizon | null = null,
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
      p_horizon: horizon ?? undefined,
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
