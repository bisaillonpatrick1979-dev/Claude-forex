import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import { pnlLatent } from './moteur';
import type {
  ContexteBougie,
  Ecriture,
  EtatMoteur,
  Evenement,
  Instrument,
  OrdreEnAttente,
  PositionOuverte,
  ResultatBougie,
} from './types';

type OriginePosition = Database['public']['Enums']['origine_position'];

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
  /** Renseigné quand l'ordre vient d'un agent : c'est ce qui permet d'isoler
   *  ensuite le résultat des agents de celui des ordres passés à la main. */
  readonly origine?: OriginePosition;
  /** Fourni par les appelants qui disposent du contexte de bougie ; sert à
   *  écrire le latent de chaque position ouverte. Sans lui, le latent reste à
   *  sa valeur précédente plutôt que d'être remis à zéro à tort. */
  readonly reevaluation?: { readonly contexte: ContexteBougie; readonly taux: number | null };
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
  await reevaluerPositions(client, contexte, etat.positions);

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

  // L'origine se lit sur l'ordre qui a ouvert la position, pas sur le lot
  // traité : une même bougie peut remplir un ordre manuel et un ordre d'agent,
  // et les attribuer en bloc fausserait le résultat affiché de l'enveloppe.
  const idsOrdres = ouvertures
    .map((evenement) => evenement.ordreId)
    .filter((id): id is string => typeof id === 'string');

  const origines = new Map<string, OriginePosition>();
  if (idsOrdres.length > 0) {
    const { data } = await client.from('ordres').select('id, origine').in('id', idsOrdres);
    for (const ligne of data ?? []) origines.set(ligne.id, ligne.origine);
  }

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
        origine:
          (evenement.ordreId ? origines.get(evenement.ordreId) : undefined) ??
          contexte.origine ??
          'MANUEL',
        ouvert_le: new Date(position.ouvertLe * 1000).toISOString(),
      },
    ];
  });

  if (lignes.length > 0) await client.from('positions').insert(lignes);
}

/**
 * Écrit le latent de chaque position encore ouverte.
 *
 * Le moteur le calcule déjà pour réévaluer l'équité ; on le persiste ici pour
 * pouvoir répondre séparément à « combien les agents ont-ils gagné » et
 * « combien ai-je gagné moi-même ». Sans taux de conversion connu on
 * s'abstient : écrire 0 laisserait croire à une position à l'équilibre.
 */
async function reevaluerPositions(
  client: Client,
  contexte: ContextePersistance,
  positions: readonly PositionOuverte[],
): Promise<void> {
  const reevaluation = contexte.reevaluation;
  if (!reevaluation) return;
  await reevaluerOuvertes(client, reevaluation.contexte, reevaluation.taux, positions);
}

/**
 * Écrit le latent des positions ouvertes, indépendamment de tout événement.
 *
 * `appliquerResultat` n'est appelée que lorsqu'une bougie produit quelque
 * chose — un remplissage, une fermeture, une écriture comptable. Une position
 * détenue pendant cent bougies calmes ne déclenchait donc aucune réévaluation
 * en base, et l'interface affichait un latent de zéro alors que le prix avait
 * bougé. Les chiffres montrés doivent être les vrais : cette fonction est
 * appelée à la fin de chaque avancée, qu'il se soit passé quelque chose ou non.
 *
 * Sans taux de conversion connu, on s'abstient plutôt que d'écrire zéro : une
 * position à l'équilibre et une position non évaluable ne sont pas la même
 * chose.
 */
export async function reevaluerOuvertes(
  client: Client,
  contexte: ContexteBougie,
  taux: number | null,
  positions: readonly PositionOuverte[],
): Promise<void> {
  if (taux === null || positions.length === 0) return;

  for (const position of positions) {
    await client
      .from('positions')
      .update({ pnl_latent: pnlLatent(position, contexte, taux) })
      .eq('id', position.id);
  }
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
