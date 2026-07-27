import type { SupabaseClient } from '@supabase/supabase-js';

import { appelerModele } from '@/lib/ia/appel';
import { budgetSuffisant, etatBudget } from '@/lib/ia/budget';
import { calculerEmbedding, versLitteral } from '@/lib/ia/embeddings';
import type { Database } from '@/types/base-de-donnees';

import { analyser, schemaLecon } from './extraction';
import { chargerAgents } from './journal-cycle';
import { construireSysteme } from './invites';

type Client = SupabaseClient<Database>;

/**
 * Agent de réflexion : le post-mortem des positions fermées.
 *
 * C'est le seul endroit où la firme apprend. Une leçon n'est utile que si un
 * cycle futur peut s'en servir, donc elle est écrite avec son embedding et
 * rattachée au symbole : la recherche vectorielle la resservira quand un
 * instantané ressemblera à celui qui l'a produite.
 *
 * Deux garde-fous qui ne sont pas des détails :
 *
 *  - une position n'est débriefée qu'une fois. Sans cela, la mémoire se
 *    remplirait de doublons et la recherche ne rendrait plus que dix variantes
 *    de la même leçon.
 *  - la réflexion consomme le même plafond quotidien que le reste. Une firme
 *    qui ferme trente positions d'un coup ne doit pas épuiser le budget en
 *    débriefs au point de ne plus pouvoir trader.
 *
 * Le résultat est présenté à l'agent tel qu'il est, pertes comprises. On ne lui
 * demande pas de tirer une leçon positive : « le stop était trop serré » est
 * une conclusion parfaitement valide, et souvent la bonne.
 */

export interface ResultatReflexion {
  readonly ok: boolean;
  readonly message: string;
  readonly leconsEcrites: number;
}

interface PositionFermee {
  readonly id: string;
  readonly symboleId: string | null;
  readonly symbole: string;
  readonly cycleId: string | null;
  readonly sens: string;
  readonly quantite: number;
  readonly prixEntree: number;
  readonly prixSortie: number | null;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly pnl: number | null;
  readonly motif: string | null;
  readonly ouvertLe: string;
  readonly fermeLe: string | null;
  readonly origine: string;
}

/** Positions fermées qui n'ont pas encore de leçon. */
async function positionsADebriefer(
  client: Client,
  profilId: string,
  maximum: number,
): Promise<readonly PositionFermee[]> {
  const { data: dejaVues } = await client
    .from('lecons')
    .select('position_id')
    .eq('profil_id', profilId)
    .not('position_id', 'is', null);

  const exclues = new Set((dejaVues ?? []).map((ligne) => ligne.position_id));

  const { data } = await client
    .from('positions')
    .select(
      'id, symbole_id, cycle_id, sens, quantite, prix_entree, prix_sortie, stop_loss, take_profit, pnl_realise, motif_sortie, ouvert_le, ferme_le, origine, symboles(code)',
    )
    .eq('profil_id', profilId)
    .in('statut', ['FERMEE', 'LIQUIDEE'])
    .order('ferme_le', { ascending: false })
    .limit(maximum + exclues.size);

  return (data ?? [])
    .filter((ligne) => !exclues.has(ligne.id))
    .slice(0, maximum)
    .map((ligne) => ({
      id: ligne.id,
      symboleId: ligne.symbole_id,
      symbole: ligne.symboles?.code ?? '—',
      cycleId: ligne.cycle_id,
      sens: ligne.sens,
      quantite: Number(ligne.quantite),
      prixEntree: Number(ligne.prix_entree),
      prixSortie: ligne.prix_sortie === null ? null : Number(ligne.prix_sortie),
      stopLoss: ligne.stop_loss === null ? null : Number(ligne.stop_loss),
      takeProfit: ligne.take_profit === null ? null : Number(ligne.take_profit),
      pnl: ligne.pnl_realise === null ? null : Number(ligne.pnl_realise),
      motif: ligne.motif_sortie,
      ouvertLe: ligne.ouvert_le,
      fermeLe: ligne.ferme_le,
      origine: ligne.origine,
    }));
}

/** Ce que le cycle d'origine attendait, s'il y en avait un. C'est la moitié la
 *  plus utile du débrief : sans l'attente, il ne reste que le résultat. */
async function attenteDuCycle(client: Client, cycleId: string | null): Promise<string> {
  if (!cycleId) {
    return 'Aucun cycle d’origine : la position a été ouverte à la main, sans vue de marché archivée.';
  }

  const { data } = await client
    .from('vues_marche')
    .select('direction, conviction, horizon, niveau_invalidation, resume')
    .eq('cycle_id', cycleId)
    .maybeSingle();

  if (!data) return 'Le cycle d’origine n’a pas produit de vue de marché exploitable.';

  return [
    `Direction attendue : ${data.direction}, conviction ${data.conviction}/100.`,
    data.horizon ? `Horizon : ${data.horizon}.` : '',
    data.niveau_invalidation === null
      ? 'Niveau d’invalidation : donnée manquante.'
      : `Niveau d’invalidation annoncé : ${data.niveau_invalidation}.`,
    data.resume,
  ]
    .filter(Boolean)
    .join('\n');
}

function recitPosition(position: PositionFermee): string {
  const duree =
    position.fermeLe === null
      ? 'donnée manquante'
      : `${Math.round((new Date(position.fermeLe).getTime() - new Date(position.ouvertLe).getTime()) / 60_000)} minutes`;

  return [
    `POSITION FERMÉE — ${position.symbole}`,
    `Sens : ${position.sens}, taille ${position.quantite} lot(s).`,
    `Entrée : ${position.prixEntree}${position.stopLoss === null ? ', sans stop enregistré' : `, stop ${position.stopLoss}`}${position.takeProfit === null ? '' : `, cible ${position.takeProfit}`}.`,
    `Sortie : ${position.prixSortie ?? 'donnée manquante'} — motif : ${position.motif ?? 'non renseigné'}.`,
    `Résultat : ${position.pnl === null ? 'donnée manquante' : position.pnl.toFixed(2)}.`,
    `Durée de détention : ${duree}.`,
    `Origine : ${position.origine === 'AGENT' ? 'décision des agents' : 'ordre passé à la main'}.`,
  ].join('\n');
}

/**
 * Débriefe les positions fermées et écrit les leçons.
 *
 * Appelée à la fin d'un cycle et depuis un bouton de l'interface. Le nombre de
 * positions traitées par passage est volontairement bas : mieux vaut rattraper
 * le retard sur plusieurs cycles que dépenser tout le budget d'un coup.
 */
export async function reflechirSurPositionsFermees(
  client: Client,
  profilId: string,
  maximum = 3,
): Promise<ResultatReflexion> {
  const budget = await etatBudget(client, profilId);
  if (!budgetSuffisant(budget)) {
    return {
      ok: false,
      leconsEcrites: 0,
      message: `Plafond de dépense quotidien atteint : le débrief est reporté à demain (UTC).`,
    };
  }

  const agents = await chargerAgents(client, profilId);
  const reflexion = agents.find((agent) => agent.role === 'AGENT_REFLEXION');
  if (!reflexion) {
    return {
      ok: false,
      leconsEcrites: 0,
      message: 'Aucun agent de réflexion actif : rien n’est débriefé.',
    };
  }

  const positions = await positionsADebriefer(client, profilId, maximum);
  if (positions.length === 0) {
    return {
      ok: true,
      leconsEcrites: 0,
      message: 'Aucune position fermée en attente de débrief.',
    };
  }

  let ecrites = 0;
  const echecs: string[] = [];

  for (const position of positions) {
    // Le budget est revérifié à chaque tour : trois débriefs peuvent suffire à
    // franchir le plafond quand un modèle coûteux est configuré.
    const budgetCourant = await etatBudget(client, profilId);
    if (!budgetSuffisant(budgetCourant)) {
      echecs.push('plafond quotidien atteint en cours de débrief');
      break;
    }

    try {
      const appel = await appelerModele({
        client,
        profilId,
        cycleId: position.cycleId,
        agent: {
          id: reflexion.id,
          fournisseur: reflexion.fournisseur,
          modele: reflexion.modele,
          temperature: reflexion.temperature,
          tokensMax: reflexion.tokensMax,
          effort: reflexion.effort,
        },
        systeme: construireSysteme(
          {
            mandat: reflexion.mandat,
            nomAgent: reflexion.nom,
            modeOperation: 'débrief',
            strategies: [],
            lecons: [],
          },
          'lecon',
        ),
        messages: [
          { role: 'utilisateur', contenu: recitPosition(position) },
          {
            role: 'utilisateur',
            contenu: `CE QUI ÉTAIT ATTENDU\n${await attenteDuCycle(client, position.cycleId)}`,
          },
          {
            role: 'utilisateur',
            contenu:
              'Écris une leçon réutilisable. Une leçon qui ne changerait rien à un cycle futur ne vaut rien : sois concret. Si la perte vient d’une erreur de méthode, dis-le ; si elle vient du hasard, dis-le aussi — confondre les deux fait désapprendre.',
          },
        ],
        formatJson: 'lecon',
        contexteDeterministe: {
          symbole: position.symbole,
          dernierPrix: position.prixSortie ?? position.prixEntree,
          atr: null,
          decimales: 5,
        },
      });

      const lecture = analyser(schemaLecon, appel.contenu);
      if (!lecture.ok || !lecture.valeur) {
        echecs.push(`${position.symbole} : ${lecture.erreur ?? 'sortie illisible'}`);
        continue;
      }

      // L'embedding porte sur le contenu de la leçon, pas sur son titre : c'est
      // le contenu qu'on voudra rapprocher d'une situation de marché.
      let embedding: { vecteur: readonly number[]; methode: string } | null = null;
      try {
        embedding = await calculerEmbedding(
          client,
          profilId,
          `${lecture.valeur.titre}\n${lecture.valeur.contenu}`,
        );
      } catch {
        // Leçon sans vecteur : lisible dans l'historique, mais jamais
        // retrouvée par la recherche. On l'écrit quand même et on le signale
        // plutôt que de la perdre.
        echecs.push(`${position.symbole} : leçon écrite sans embedding`);
      }

      await client.from('lecons').insert({
        profil_id: profilId,
        position_id: position.id,
        cycle_id: position.cycleId,
        symbole_id: position.symboleId,
        titre: lecture.valeur.titre,
        contenu: lecture.valeur.contenu,
        etiquettes: lecture.valeur.etiquettes,
        resultat_pnl: position.pnl,
        embedding: embedding ? versLitteral(embedding.vecteur) : null,
        methode_embedding: embedding?.methode ?? null,
      });

      ecrites += 1;
    } catch (erreur) {
      echecs.push(
        `${position.symbole} : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}`,
      );
    }
  }

  const resume =
    ecrites === 0
      ? 'Aucune leçon écrite.'
      : `${ecrites} leçon(s) écrite(s) et indexée(s) pour les cycles à venir.`;

  return {
    ok: ecrites > 0,
    leconsEcrites: ecrites,
    message: echecs.length > 0 ? `${resume} Incidents : ${echecs.join(' ; ')}.` : resume,
  };
}
