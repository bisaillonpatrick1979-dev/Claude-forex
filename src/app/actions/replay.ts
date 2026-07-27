'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { tauxConversion } from '@/lib/execution/couts';
import { traiterBougie } from '@/lib/execution/moteur';
import { appliquerResultat, chargerEtat, chargerInstrument } from '@/lib/execution/persistance';
import { SIMULATION_DEFAUT, type ContexteBougie } from '@/lib/execution/types';
import {
  bougiesApres,
  departRejeu,
  fenetreSimulee,
  nombreBougies,
  profondeurMaximaleJours,
  type SourceRejeu,
} from '@/lib/marche/historique';
import { atr, derniereValeur } from '@/lib/marche/indicateurs';
import { estIntervalle } from '@/lib/marche/intervalles';
import { obtenirChandeliers } from '@/lib/marche/routeur';
import type { Chandelier, Intervalle } from '@/lib/marche/types';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Rejeu historique : faire défiler le marché à la vitesse choisie.
 *
 * La vitesse est pilotée par le navigateur, qui appelle `avancerRejeu` à
 * intervalle régulier. Le serveur ne connaît que « avance de N bougies » :
 * une horloge côté serveur exigerait un processus qui survive entre deux
 * requêtes, ce qu'un palier gratuit sans serveur ne fournit pas.
 *
 * Chaque bougie rejouée passe par exactement le même `traiterBougie` que le
 * papier temps réel. Le rejeu ne teste donc pas un moteur parallèle : il teste
 * celui qui trade.
 */

export interface ResultatRejeu {
  readonly ok: boolean;
  readonly message: string;
  readonly curseur: number | null;
  readonly bougiesTraitees: number;
  readonly termine: boolean;
  readonly progression: { readonly faites: number; readonly total: number } | null;
}

const echec = (message: string): ResultatRejeu => ({
  ok: false,
  message,
  curseur: null,
  bougiesTraitees: 0,
  termine: false,
  progression: null,
});

const schemaDemarrage = z.object({
  symbole: z.string().min(1).max(20),
  intervalle: z.string().refine(estIntervalle, 'Intervalle inconnu.'),
  joursEnArriere: z.coerce.number().int().min(1).max(15 * 365),
  source: z.enum(['SIMULE', 'FOURNISSEUR']),
});

export type SaisieDemarrage = z.input<typeof schemaDemarrage>;

/**
 * Ouvre un rejeu et remet l'horloge du portefeuille au point de départ.
 *
 * Les positions ouvertes sont laissées telles quelles : les fermer d'office
 * détruirait du travail en cours sans le dire. C'est à l'utilisateur de solder
 * avant de remonter le temps, et l'interface le lui rappelle.
 */
export async function demarrerRejeu(saisie: SaisieDemarrage): Promise<ResultatRejeu> {
  const profilId = await profilAuthentifie();
  if (!profilId) return echec('Session expirée.');

  const analyse = schemaDemarrage.safeParse(saisie);
  if (!analyse.success) {
    return echec(analyse.error.issues[0]?.message ?? 'Saisie invalide.');
  }
  const donnees = analyse.data;
  const intervalle = donnees.intervalle as Intervalle;
  const source = donnees.source as SourceRejeu;

  const plafond = profondeurMaximaleJours(intervalle, source);
  if (donnees.joursEnArriere > plafond) {
    return echec(
      source === 'FOURNISSEUR'
        ? `En ${intervalle}, les fournisseurs gratuits ne remontent pas au-delà d’environ ${plafond} jours. Choisissez un intervalle plus large, ou la source simulée.`
        : `Profondeur maximale : ${plafond} jours.`,
    );
  }

  const client = clientAdminOptionnel();
  if (!client) return echec('SUPABASE_SERVICE_ROLE_KEY absente côté serveur.');

  const { data: portefeuille } = await client
    .from('portefeuilles')
    .select('id')
    .eq('profil_id', profilId)
    .limit(1)
    .maybeSingle();

  if (!portefeuille) return echec('Aucun portefeuille pour ce profil.');

  const maintenant = Math.floor(Date.now() / 1000);
  const debut = departRejeu(intervalle, donnees.joursEnArriere, maintenant);

  const { error } = await client
    .from('portefeuilles')
    .update({
      rejeu_actif: true,
      rejeu_symbole: donnees.symbole,
      rejeu_intervalle: intervalle,
      rejeu_debut: debut,
      rejeu_curseur: debut,
      rejeu_fin: maintenant,
      rejeu_source: source,
      // L'horloge du moteur recule avec le rejeu : sans cela, la barrière
      // anti-look-ahead refuserait toutes les bougies du passé.
      dernier_horodatage_traite: debut,
    })
    .eq('id', portefeuille.id);

  if (error) return echec(error.message);

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'REJEU_DEMARRE',
    entite: 'portefeuilles',
    entite_id: portefeuille.id,
    details: { symbole: donnees.symbole, intervalle, source, jours: donnees.joursEnArriere },
  });

  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    message: `Rejeu ouvert sur ${donnees.symbole} en ${intervalle}, à partir du ${new Date(debut * 1000).toISOString().slice(0, 10)}.`,
    curseur: debut,
    bougiesTraitees: 0,
    termine: false,
    progression: { faites: 0, total: nombreBougies(debut, maintenant, intervalle) },
  };
}

const schemaAvance = z.object({
  bougies: z.coerce.number().int().min(1).max(500),
});

/**
 * Avance le rejeu de N bougies.
 *
 * Le plafond de 500 par appel n'est pas arbitraire : au-delà, la fonction
 * dépasse la durée maximale d'exécution du palier gratuit, et le lot est perdu
 * en entier. Pour aller plus vite, le navigateur appelle plus souvent.
 */
export async function avancerRejeu(bougies: number): Promise<ResultatRejeu> {
  const profilId = await profilAuthentifie();
  if (!profilId) return echec('Session expirée.');

  if (!limiterDebit(`rejeu:${profilId}`, 240, 60_000).autorise) {
    return echec('Rejeu trop rapide pour le serveur. Réduisez la vitesse.');
  }

  const analyse = schemaAvance.safeParse({ bougies });
  if (!analyse.success) return echec('Nombre de bougies invalide.');

  const client = clientAdminOptionnel();
  if (!client) return echec('SUPABASE_SERVICE_ROLE_KEY absente côté serveur.');

  const { data: portefeuille } = await client
    .from('portefeuilles')
    .select('id, rejeu_actif, rejeu_symbole, rejeu_intervalle, rejeu_debut, rejeu_curseur, rejeu_fin, rejeu_source, gele')
    .eq('profil_id', profilId)
    .limit(1)
    .maybeSingle();

  if (!portefeuille) return echec('Aucun portefeuille pour ce profil.');
  if (!portefeuille.rejeu_actif) return echec('Aucun rejeu en cours.');
  if (portefeuille.gele) return echec('Portefeuille gelé : le moteur est à l’arrêt.');

  const symbole = portefeuille.rejeu_symbole;
  const intervalle = portefeuille.rejeu_intervalle;
  const curseur = portefeuille.rejeu_curseur;
  const fin = portefeuille.rejeu_fin;

  if (!symbole || !intervalle || curseur === null || fin === null) {
    return echec('Rejeu incomplet en base : redémarrez-le.');
  }

  const instrument = await chargerInstrument(client, symbole);
  if (!instrument) return echec(`Instrument ${symbole} inconnu.`);

  const persiste = await chargerEtat(client, profilId, symbole);
  if (!persiste) return echec('Aucun portefeuille pour ce profil.');

  // Fenêtre large : les indicateurs ont besoin d'historique avant le curseur,
  // et le moteur des bougies qui suivent. On demande donc de quoi couvrir les
  // deux en un seul chargement.
  const demandees = analyse.data.bougies;
  const source = (portefeuille.rejeu_source ?? 'SIMULE') as SourceRejeu;
  const dureeIntervalle = (fin - curseur) / Math.max(1, nombreBougies(curseur, fin, intervalle));
  const jusqua = Math.min(fin, curseur + Math.ceil(demandees * dureeIntervalle));

  let fenetre: readonly Chandelier[];
  if (source === 'SIMULE') {
    fenetre = fenetreSimulee({
      symbole,
      classeActif: instrument.instrument.classeActif,
      intervalle,
      jusqua,
      limite: demandees + 250,
    });
  } else {
    // Le routeur ne sait servir que la fenêtre la plus récente : un rejeu sur
    // données réelles ne peut donc pas remonter au-delà de ce que le cache et
    // le fournisseur détiennent. C'est dit au démarrage, pas découvert ici.
    const marche = await obtenirChandeliers({
      client,
      profilId,
      symbole,
      intervalle,
      limite: 1000,
    });
    fenetre = marche.chandeliers;
  }

  const aTraiter = bougiesApres(fenetre, curseur, demandees);

  if (aTraiter.length === 0) {
    const termine = curseur >= fin;
    if (termine) {
      await client
        .from('portefeuilles')
        .update({ rejeu_actif: false })
        .eq('id', portefeuille.id);
    }
    return {
      ok: true,
      message: termine
        ? 'Rejeu terminé : le curseur a rejoint le présent.'
        : 'Aucune bougie disponible sur cette fenêtre — le fournisseur ne remonte pas jusque-là.',
      curseur,
      bougiesTraitees: 0,
      termine,
      progression: {
        faites: nombreBougies(portefeuille.rejeu_debut ?? curseur, curseur, intervalle),
        total: nombreBougies(portefeuille.rejeu_debut ?? curseur, fin, intervalle),
      },
    };
  }

  let etat = persiste.etat;
  let dernierHorodatage = curseur;

  for (const bougie of aTraiter) {
    // L'ATR est recalculé sur l'historique connu à cet instant du rejeu, pas
    // sur la série entière : utiliser des bougies postérieures reviendrait à
    // laisser le moteur regarder l'avenir.
    const historique = fenetre.filter((candidat) => candidat.horodatage <= bougie.horodatage);
    const taux = tauxConversion(
      instrument.instrument,
      bougie.cloture,
      persiste.etat.portefeuille.devise,
    );

    const contexte: ContexteBougie = {
      instrument: instrument.instrument,
      intervalle,
      bougie,
      atr: derniereValeur(atr(historique, 14)),
      tauxCotationVersCompte: taux,
      parametres: SIMULATION_DEFAUT,
    };

    const resultat = traiterBougie(etat, contexte);
    etat = resultat.etat;
    dernierHorodatage = bougie.horodatage;

    if (resultat.evenements.length > 0 || resultat.ecritures.length > 0) {
      await appliquerResultat(
        client,
        {
          profilId,
          portefeuilleId: persiste.portefeuilleId,
          symboleId: instrument.symboleId,
          reevaluation: { contexte, taux },
        },
        resultat,
        bougie.horodatage,
      );
    }
  }

  const termine = dernierHorodatage >= fin;

  await client
    .from('portefeuilles')
    .update({
      solde: etat.portefeuille.solde,
      equite: etat.portefeuille.equite,
      marge_utilisee: etat.portefeuille.margeUtilisee,
      sommet_equite: etat.portefeuille.sommetEquite,
      dernier_horodatage_traite: dernierHorodatage,
      rejeu_curseur: dernierHorodatage,
      rejeu_actif: !termine,
    })
    .eq('id', persiste.portefeuilleId);

  revalidatePath('/salle-des-marches');

  return {
    ok: true,
    message: termine
      ? 'Rejeu terminé : le curseur a rejoint le présent.'
      : `${aTraiter.length} bougie(s) rejouée(s).`,
    curseur: dernierHorodatage,
    bougiesTraitees: aTraiter.length,
    termine,
    progression: {
      faites: nombreBougies(portefeuille.rejeu_debut ?? curseur, dernierHorodatage, intervalle),
      total: nombreBougies(portefeuille.rejeu_debut ?? curseur, fin, intervalle),
    },
  };
}

/** Referme le rejeu et laisse le portefeuille où il en est. */
export async function arreterRejeu(): Promise<ResultatRejeu> {
  const profilId = await profilAuthentifie();
  if (!profilId) return echec('Session expirée.');

  const client = clientAdminOptionnel();
  if (!client) return echec('SUPABASE_SERVICE_ROLE_KEY absente côté serveur.');

  const { error } = await client
    .from('portefeuilles')
    .update({ rejeu_actif: false })
    .eq('profil_id', profilId);

  if (error) return echec(error.message);

  revalidatePath('/salle-des-marches');
  return {
    ok: true,
    message:
      'Rejeu arrêté. Le portefeuille garde ses positions et son solde : ce sont de vrais résultats simulés, pas une prévisualisation.',
    curseur: null,
    bougiesTraitees: 0,
    termine: true,
    progression: null,
  };
}
