import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import type {
  Ecriture,
  EtatMoteur,
  Evenement,
  Instrument,
  OrdreEnAttente,
  PositionOuverte,
  ResultatBougie,
} from './types';

type Client = SupabaseClient<Database>;

/**
 * Pont entre le moteur (état en mémoire, fonctions pures) et Supabase.
 *
 * Le moteur ne connaît pas la base : il reçoit un état, rend un état et une
 * liste d'événements. Ce fichier est le seul à traduire. C'est ce découplage
 * qui permettra au backtest (phase 6) de faire tourner exactement le même
 * moteur sans écrire une seule ligne en base.
 *
 * Les identifiants produits par le moteur sont des UUID et deviennent
 * directement les clés primaires : aucune table de correspondance.
 */

export interface EtatPersiste {
  readonly etat: EtatMoteur;
  readonly portefeuilleId: string;
  readonly dernierHorodatageTraite: number | null;
}

export async function chargerInstrument(
  client: Client,
  code: string,
): Promise<{ instrument: Instrument; symboleId: string } | null> {
  const { data } = await client
    .from('symboles')
    .select(
      'id, code, classe_actif, devise_base, devise_cotation, taille_contrat, pas_cotation, decimales, spread_defaut_points, commission_par_unite, swap_long_points, swap_court_points, levier_max, horaires_seance',
    )
    .eq('code', code)
    .eq('actif', true)
    .maybeSingle();

  if (!data) return null;

  return {
    symboleId: data.id,
    instrument: {
      code: data.code,
      classeActif: data.classe_actif,
      deviseBase: data.devise_base,
      deviseCotation: data.devise_cotation,
      tailleContrat: Number(data.taille_contrat),
      pasCotation: Number(data.pas_cotation),
      decimales: data.decimales,
      spreadDefautPoints: Number(data.spread_defaut_points),
      // La colonne s'appelle « par unité » ; l'unité est le lot.
      commissionParLot: Number(data.commission_par_unite),
      swapLongPoints: Number(data.swap_long_points),
      swapCourtPoints: Number(data.swap_court_points),
      levierMax: Number(data.levier_max),
      horairesSeance: lireHoraires(data.horaires_seance),
    },
  };
}

function lireHoraires(valeur: unknown): Instrument['horairesSeance'] {
  if (typeof valeur !== 'object' || valeur === null) return {};
  const sortie: Record<string, (readonly [string, string])[]> = {};

  for (const [jour, plages] of Object.entries(valeur as Record<string, unknown>)) {
    if (!Array.isArray(plages)) continue;
    const valides: (readonly [string, string])[] = [];
    for (const plage of plages) {
      if (Array.isArray(plage) && typeof plage[0] === 'string' && typeof plage[1] === 'string') {
        valides.push([plage[0], plage[1]]);
      }
    }
    if (valides.length > 0) sortie[jour] = valides;
  }

  return sortie;
}

/** Charge l'état complet du moteur pour un instrument donné. */
export async function chargerEtat(
  client: Client,
  profilId: string,
  instrumentCode: string,
): Promise<EtatPersiste | null> {
  const { data: portefeuille } = await client
    .from('portefeuilles')
    .select('id, devise, capital_initial, solde, equite, marge_utilisee, sommet_equite, gele, dernier_horodatage_traite')
    .eq('profil_id', profilId)
    .limit(1)
    .maybeSingle();

  if (!portefeuille) return null;

  const [{ data: ordres }, { data: positions }] = await Promise.all([
    client
      .from('ordres')
      .select('id, sens, type_ordre, quantite, quantite_remplie, prix_demande, stop_loss, take_profit, valide_jusqu_a, cree_le, symboles(code)')
      .eq('portefeuille_id', portefeuille.id)
      .in('statut', ['EN_ATTENTE', 'PARTIELLEMENT_REMPLI']),
    client
      .from('positions')
      .select('id, sens, quantite, prix_entree, stop_loss, take_profit, marge_immobilisee, commission_totale, swap_total, ouvert_le, symboles(code)')
      .eq('portefeuille_id', portefeuille.id)
      .eq('statut', 'OUVERTE'),
  ]);

  const ordresMoteur: OrdreEnAttente[] = (ordres ?? [])
    .filter((ligne) => ligne.symboles?.code === instrumentCode)
    .map((ligne) => ({
      id: ligne.id,
      instrument: instrumentCode,
      sens: ligne.sens,
      type: ligne.type_ordre,
      quantite: Number(ligne.quantite),
      prixDemande: ligne.prix_demande === null ? null : Number(ligne.prix_demande),
      stopLoss: ligne.stop_loss === null ? null : Number(ligne.stop_loss),
      takeProfit: ligne.take_profit === null ? null : Number(ligne.take_profit),
      horodatageDecision: Math.floor(new Date(ligne.cree_le).getTime() / 1000),
      valideJusqua:
        ligne.valide_jusqu_a === null
          ? null
          : Math.floor(new Date(ligne.valide_jusqu_a).getTime() / 1000),
      quantiteRemplie: Number(ligne.quantite_remplie),
    }));

  const positionsMoteur: PositionOuverte[] = (positions ?? [])
    .filter((ligne) => ligne.symboles?.code === instrumentCode)
    .map((ligne) => ({
      id: ligne.id,
      instrument: instrumentCode,
      sens: ligne.sens,
      quantite: Number(ligne.quantite),
      prixEntree: Number(ligne.prix_entree),
      stopLoss: ligne.stop_loss === null ? null : Number(ligne.stop_loss),
      takeProfit: ligne.take_profit === null ? null : Number(ligne.take_profit),
      margeImmobilisee: Number(ligne.marge_immobilisee),
      commissionTotale: Number(ligne.commission_totale),
      swapTotal: Number(ligne.swap_total),
      ouvertLe: Math.floor(new Date(ligne.ouvert_le).getTime() / 1000),
      dernierSwapLe: Math.floor(new Date(ligne.ouvert_le).getTime() / 1000),
    }));

  return {
    portefeuilleId: portefeuille.id,
    dernierHorodatageTraite: portefeuille.dernier_horodatage_traite,
    etat: {
      portefeuille: {
        devise: portefeuille.devise,
        capitalInitial: Number(portefeuille.capital_initial),
        solde: Number(portefeuille.solde),
        equite: Number(portefeuille.equite),
        margeUtilisee: Number(portefeuille.marge_utilisee),
        sommetEquite: Number(portefeuille.sommet_equite),
        gele: portefeuille.gele,
      },
      ordres: ordresMoteur,
      positions: positionsMoteur,
    },
  };
}

interface ContextePersistance {
  readonly profilId: string;
  readonly portefeuilleId: string;
  readonly symboleId: string;
  readonly cycleId?: string | null;
}

/**
 * Écrit le résultat d'un traitement.
 *
 * Ordre imposé : positions ouvertes d'abord (les transactions y font
 * référence), puis fermetures, puis ordres, puis le grand livre, puis le
 * portefeuille. Une transaction dont la position n'existe pas encore violerait
 * la clé étrangère.
 */
export async function appliquerResultat(
  client: Client,
  contexte: ContextePersistance,
  resultat: ResultatBougie,
  horodatageTraite: number,
): Promise<void> {
  const { evenements, ecritures, etat } = resultat;

  await insererPositions(client, contexte, evenements, etat.positions);
  await fermerPositions(client, evenements);
  await majOrdres(client, evenements, etat.ordres);
  await insererTransactions(client, contexte, ecritures);

  await client
    .from('portefeuilles')
    .update({
      solde: etat.portefeuille.solde,
      equite: etat.portefeuille.equite,
      marge_utilisee: etat.portefeuille.margeUtilisee,
      sommet_equite: etat.portefeuille.sommetEquite,
      dernier_horodatage_traite: horodatageTraite,
    })
    .eq('id', contexte.portefeuilleId);
}

async function insererPositions(
  client: Client,
  contexte: ContextePersistance,
  evenements: readonly Evenement[],
  positions: readonly PositionOuverte[],
): Promise<void> {
  const ouvertures = evenements.filter((evenement) => evenement.type === 'POSITION_OUVERTE');
  if (ouvertures.length === 0) return;

  const lignes = ouvertures.flatMap((evenement) => {
    const position = positions.find((candidate) => candidate.id === evenement.positionId);
    if (!position) return [];
    return [
      {
        id: position.id,
        profil_id: contexte.profilId,
        portefeuille_id: contexte.portefeuilleId,
        symbole_id: contexte.symboleId,
        cycle_id: contexte.cycleId ?? null,
        ordre_ouverture_id: evenement.ordreId ?? null,
        sens: position.sens,
        quantite: position.quantite,
        prix_entree: position.prixEntree,
        stop_loss: position.stopLoss,
        take_profit: position.takeProfit,
        marge_immobilisee: position.margeImmobilisee,
        commission_totale: position.commissionTotale,
        swap_total: position.swapTotal,
        statut: 'OUVERTE' as const,
        ouvert_le: new Date(position.ouvertLe * 1000).toISOString(),
      },
    ];
  });

  if (lignes.length > 0) await client.from('positions').insert(lignes);
}

async function fermerPositions(client: Client, evenements: readonly Evenement[]): Promise<void> {
  for (const evenement of evenements) {
    if (evenement.type !== 'POSITION_FERMEE' || !evenement.positionId) continue;
    await client
      .from('positions')
      .update({
        statut: evenement.motif === 'LIQUIDATION' ? 'LIQUIDEE' : 'FERMEE',
        prix_sortie: evenement.prix ?? null,
        pnl_realise: evenement.montant ?? null,
        motif_sortie: evenement.motif ?? null,
        ferme_le: new Date(evenement.horodatage * 1000).toISOString(),
      })
      .eq('id', evenement.positionId);
  }
}

async function majOrdres(
  client: Client,
  evenements: readonly Evenement[],
  ordresRestants: readonly OrdreEnAttente[],
): Promise<void> {
  for (const evenement of evenements) {
    if (!evenement.ordreId) continue;

    if (evenement.type === 'ORDRE_REMPLI') {
      await client
        .from('ordres')
        .update({
          statut: 'REMPLI',
          quantite_remplie: evenement.quantite ?? 0,
          prix_moyen_rempli: evenement.prix ?? null,
          rempli_le: new Date(evenement.horodatage * 1000).toISOString(),
        })
        .eq('id', evenement.ordreId);
    } else if (evenement.type === 'ORDRE_PARTIELLEMENT_REMPLI') {
      const ordre = ordresRestants.find((candidate) => candidate.id === evenement.ordreId);
      await client
        .from('ordres')
        .update({
          statut: 'PARTIELLEMENT_REMPLI',
          quantite_remplie: ordre?.quantiteRemplie ?? evenement.quantite ?? 0,
          prix_moyen_rempli: evenement.prix ?? null,
        })
        .eq('id', evenement.ordreId);
    } else if (evenement.type === 'ORDRE_EXPIRE' || evenement.type === 'ORDRE_REJETE') {
      await client
        .from('ordres')
        .update({
          statut: evenement.type === 'ORDRE_EXPIRE' ? 'EXPIRE' : 'REJETE',
          motif_fin: evenement.detail,
        })
        .eq('id', evenement.ordreId);
    }
  }
}

async function insererTransactions(
  client: Client,
  contexte: ContextePersistance,
  ecritures: readonly Ecriture[],
): Promise<void> {
  if (ecritures.length === 0) return;

  await client.from('transactions').insert(
    ecritures.map((ecriture) => ({
      profil_id: contexte.profilId,
      portefeuille_id: contexte.portefeuilleId,
      position_id: ecriture.positionId,
      type: ecriture.type,
      montant: ecriture.montant,
      solde_apres: ecriture.soldeApres,
      description: ecriture.description,
      cree_le: new Date(ecriture.horodatage * 1000).toISOString(),
    })),
  );
}
