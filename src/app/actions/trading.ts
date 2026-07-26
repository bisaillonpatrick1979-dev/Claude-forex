'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { tauxConversion } from '@/lib/execution/couts';
import { fermerManuellement, traiterBougie } from '@/lib/execution/moteur';
import { appliquerResultat, chargerEtat, chargerInstrument } from '@/lib/execution/persistance';
import { SIMULATION_DEFAUT, type ContexteBougie } from '@/lib/execution/types';
import { atr, derniereValeur } from '@/lib/marche/indicateurs';
import { estIntervalle } from '@/lib/marche/intervalles';
import { obtenirChandeliers } from '@/lib/marche/routeur';
import type { Chandelier, Intervalle } from '@/lib/marche/types';
import { evaluerGardeFous, type ParametresRisque } from '@/lib/risque/garde-fous';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Passage d'ordres manuel et avancement du marché.
 *
 * Toute création d'ordre passe par `evaluerGardeFous` : c'est le point unique
 * d'entrée, que l'ordre vienne de l'interface ou, plus tard, du gestionnaire de
 * portefeuille. Aucun chemin ne contourne les plafonds.
 */

export interface ResultatTrading {
  readonly ok: boolean;
  readonly message: string;
  readonly controles?: readonly { code: string; libelle: string; statut: string; detail: string }[];
}

const CONFIG_MANQUANTE =
  'SUPABASE_SERVICE_ROLE_KEY absente côté serveur : le moteur d’exécution ne peut pas écrire.';

const schemaOrdre = z.object({
  symbole: z.string().min(1).max(20),
  intervalle: z.string().refine(estIntervalle, 'Intervalle inconnu.'),
  sens: z.enum(['ACHAT', 'VENTE']),
  type: z.enum(['MARCHE', 'LIMITE', 'STOP']),
  quantite: z.coerce.number().positive().max(500),
  prixDemande: z.coerce.number().positive().nullable(),
  stopLoss: z.coerce.number().positive().nullable(),
  takeProfit: z.coerce.number().positive().nullable(),
});

export type SaisieOrdre = z.input<typeof schemaOrdre>;

async function contexteDepuisMarche(
  client: NonNullable<ReturnType<typeof clientAdminOptionnel>>,
  profilId: string,
  symbole: string,
  intervalle: Intervalle,
): Promise<
  | { ok: true; chandeliers: readonly Chandelier[]; contexte: ContexteBougie; symboleId: string }
  | { ok: false; message: string }
> {
  const instrument = await chargerInstrument(client, symbole);
  if (!instrument) return { ok: false, message: `Instrument ${symbole} inconnu.` };

  const marche = await obtenirChandeliers({
    client,
    profilId,
    symbole,
    intervalle,
    limite: 200,
  });

  const derniere = marche.chandeliers[marche.chandeliers.length - 1];
  if (!derniere) return { ok: false, message: 'Aucune bougie disponible.' };

  const taux = tauxConversion(instrument.instrument, derniere.cloture, 'USD');

  return {
    ok: true,
    chandeliers: marche.chandeliers,
    symboleId: instrument.symboleId,
    contexte: {
      instrument: instrument.instrument,
      intervalle,
      bougie: derniere,
      atr: derniereValeur(atr(marche.chandeliers, 14)),
      tauxCotationVersCompte: taux,
      parametres: SIMULATION_DEFAUT,
    },
  };
}

async function lireParametresRisque(
  client: NonNullable<ReturnType<typeof clientAdminOptionnel>>,
  profilId: string,
): Promise<ParametresRisque | null> {
  const { data } = await client
    .from('parametres_risque')
    .select('*')
    .eq('profil_id', profilId)
    .maybeSingle();

  if (!data) return null;

  return {
    risqueMaxParTradePct: Number(data.risque_max_par_trade_pct),
    risqueTotalMaxPct: Number(data.risque_total_max_pct),
    positionsMax: data.positions_max,
    positionsCorreleesMax: data.positions_correlees_max,
    seuilCorrelation: Number(data.seuil_correlation),
    perteJournaliereMaxPct: Number(data.perte_journaliere_max_pct),
    drawdownMaxPct: Number(data.drawdown_max_pct),
    levierMax: Number(data.levier_max),
    fenetreEvenementMacroMinutes: data.fenetre_evenement_macro_minutes,
    stopLossObligatoire: data.stop_loss_obligatoire,
  };
}

export async function passerOrdreManuel(saisie: SaisieOrdre): Promise<ResultatTrading> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  if (!limiterDebit(`ordre:${profilId}`, 30, 60_000).autorise) {
    return { ok: false, message: 'Trop d’ordres coup sur coup, réessaie dans une minute.' };
  }

  const analyse = schemaOrdre.safeParse(saisie);
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Saisie invalide.' };
  }
  const donnees = analyse.data;

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  const marche = await contexteDepuisMarche(
    client,
    profilId,
    donnees.symbole,
    donnees.intervalle as Intervalle,
  );
  if (!marche.ok) return { ok: false, message: marche.message };

  const persiste = await chargerEtat(client, profilId, donnees.symbole);
  if (!persiste) return { ok: false, message: 'Aucun portefeuille pour ce profil.' };

  const parametres = await lireParametresRisque(client, profilId);
  if (!parametres) return { ok: false, message: 'Paramètres de risque introuvables.' };

  const prixReference = donnees.prixDemande ?? marche.contexte.bougie.cloture;

  // ═══ Point de passage obligatoire ═══
  const decision = evaluerGardeFous(
    {
      instrument: marche.contexte.instrument,
      sens: donnees.sens,
      quantite: donnees.quantite,
      prixEntree: prixReference,
      stopLoss: donnees.stopLoss,
      tauxCotationVersCompte: marche.contexte.tauxCotationVersCompte,
    },
    {
      portefeuille: persiste.etat.portefeuille,
      positions: persiste.etat.positions.map((position) => ({
        position,
        instrument: marche.contexte.instrument,
        tauxCotationVersCompte: marche.contexte.tauxCotationVersCompte ?? 1,
        prixCourant: marche.contexte.bougie.cloture,
      })),
      equiteDebutJournee: persiste.etat.portefeuille.equite,
      evenementsMacro: [],
      maintenant: marche.contexte.bougie.horodatage,
    },
    parametres,
  );

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'CONTROLE_RISQUE_ORDRE_MANUEL',
    entite: 'ordres',
    entite_id: null,
    details: {
      symbole: donnees.symbole,
      decision: decision.decision,
      quantite_demandee: donnees.quantite,
      quantite_autorisee: decision.quantiteAutorisee,
      raison: decision.raison,
    },
  });

  if (decision.decision === 'REFUSE') {
    return { ok: false, message: decision.raison, controles: decision.controles };
  }

  const { error } = await client.from('ordres').insert({
    profil_id: profilId,
    portefeuille_id: persiste.portefeuilleId,
    symbole_id: marche.symboleId,
    sens: donnees.sens,
    type_ordre: donnees.type,
    quantite: decision.quantiteAutorisee,
    prix_demande: donnees.prixDemande,
    stop_loss: donnees.stopLoss,
    take_profit: donnees.takeProfit,
    statut: 'EN_ATTENTE',
    // La décision est datée de la dernière bougie connue : le remplissage ne
    // pourra donc avoir lieu qu'à partir de la suivante.
    cree_le: new Date(marche.contexte.bougie.horodatage * 1000).toISOString(),
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    message:
      decision.decision === 'REDUIT'
        ? decision.raison
        : `Ordre accepté : ${donnees.sens} ${decision.quantiteAutorisee} lot(s). Remplissage à la prochaine bougie.`,
    controles: decision.controles,
  };
}

/**
 * Fait avancer le moteur sur toutes les bougies fermées non encore traitées.
 * En papier c'est déclenché par l'interface ou un cron ; en backtest ce sera
 * une boucle sur l'historique. Même fonction `traiterBougie` dans les deux cas.
 */
export async function avancerMarche(symbole: string, intervalle: string): Promise<ResultatTrading> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estIntervalle(intervalle)) return { ok: false, message: 'Intervalle inconnu.' };

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  const marche = await contexteDepuisMarche(client, profilId, symbole, intervalle);
  if (!marche.ok) return { ok: false, message: marche.message };

  const persiste = await chargerEtat(client, profilId, symbole);
  if (!persiste) return { ok: false, message: 'Aucun portefeuille pour ce profil.' };
  if (persiste.etat.portefeuille.gele) {
    return { ok: false, message: 'Portefeuille gelé : le moteur est à l’arrêt.' };
  }

  const derniereTraitee = persiste.dernierHorodatageTraite ?? 0;
  const aTraiter = marche.chandeliers.filter(
    (chandelier) => chandelier.horodatage > derniereTraitee,
  );

  if (aTraiter.length === 0) {
    return { ok: true, message: 'Aucune nouvelle bougie à traiter.' };
  }

  let etat = persiste.etat;
  let evenements = 0;

  for (const chandelier of aTraiter) {
    const contexte: ContexteBougie = { ...marche.contexte, bougie: chandelier };
    const resultat = traiterBougie(etat, contexte);
    etat = resultat.etat;
    evenements += resultat.evenements.length;

    if (resultat.evenements.length > 0 || resultat.ecritures.length > 0) {
      await appliquerResultat(
        client,
        {
          profilId,
          portefeuilleId: persiste.portefeuilleId,
          symboleId: marche.symboleId,
        },
        resultat,
        chandelier.horodatage,
      );
    }
  }

  const derniere = aTraiter[aTraiter.length - 1]!;
  await client
    .from('portefeuilles')
    .update({
      solde: etat.portefeuille.solde,
      equite: etat.portefeuille.equite,
      marge_utilisee: etat.portefeuille.margeUtilisee,
      sommet_equite: etat.portefeuille.sommetEquite,
      dernier_horodatage_traite: derniere.horodatage,
    })
    .eq('id', persiste.portefeuilleId);

  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    message: `${aTraiter.length} bougie(s) traitée(s), ${evenements} événement(s).`,
  };
}

export async function fermerPositionManuelle(
  positionId: string,
  symbole: string,
  intervalle: string,
): Promise<ResultatTrading> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estIntervalle(intervalle)) return { ok: false, message: 'Intervalle inconnu.' };

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  const marche = await contexteDepuisMarche(client, profilId, symbole, intervalle);
  if (!marche.ok) return { ok: false, message: marche.message };

  const persiste = await chargerEtat(client, profilId, symbole);
  if (!persiste) return { ok: false, message: 'Aucun portefeuille pour ce profil.' };

  const resultat = fermerManuellement(persiste.etat, positionId, marche.contexte);
  if (resultat.evenements.length === 0) {
    return { ok: false, message: 'Position introuvable ou taux de conversion inconnu.' };
  }

  await appliquerResultat(
    client,
    { profilId, portefeuilleId: persiste.portefeuilleId, symboleId: marche.symboleId },
    resultat,
    persiste.dernierHorodatageTraite ?? marche.contexte.bougie.horodatage,
  );

  const fermeture = resultat.evenements.find((evenement) => evenement.type === 'POSITION_FERMEE');
  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    message: `Position fermée à ${fermeture?.prix ?? '—'} (résultat ${fermeture?.montant?.toFixed(2) ?? '—'}).`,
  };
}
