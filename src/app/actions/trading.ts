'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { contexteDepuisMarche, lireParametresRisque } from '@/lib/execution/contexte-serveur';
import { fermerManuellement, traiterBougie } from '@/lib/execution/moteur';
import {
  appliquerResultat,
  chargerEtat,
  reevaluerOuvertes,
} from '@/lib/execution/persistance';
import type { ContexteBougie } from '@/lib/execution/types';
import { estIntervalle } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';
import { evaluerGardeFous } from '@/lib/risque/garde-fous';
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

  // Réévaluation systématique, événement ou pas : une position détenue pendant
  // cent bougies calmes doit voir son latent bouger avec le prix. Sans cet
  // appel, l'écran affichait 0,00 $ de latent en permanence.
  const contexteFinal: ContexteBougie = { ...marche.contexte, bougie: derniere };
  await reevaluerOuvertes(
    client,
    contexteFinal,
    marche.contexte.tauxCotationVersCompte,
    etat.positions,
  );

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

/**
 * Fait avancer le moteur sur TOUS les instruments qui en ont besoin.
 *
 * `avancerMarche` ne traite que le symbole affiché — c'était suffisant quand
 * seul l'utilisateur passait des ordres, sur l'instrument qu'il regardait. Ce
 * ne l'est plus depuis que la veille fait travailler les agents sur une
 * douzaine de marchés : leurs ordres s'accumulaient en attente d'une bougie
 * qui n'arrivait jamais, et l'enveloppe des agents restait à zéro alors qu'ils
 * avaient bel et bien décidé dix-huit fois.
 *
 * Les instruments retenus sont ceux qui portent un ordre en attente ou une
 * position ouverte. Traiter les autres consommerait du quota de fournisseur
 * pour rien.
 *
 * Le curseur `dernier_horodatage_traite` est global au portefeuille et non par
 * symbole. C'est acceptable parce qu'il s'agit d'un horodatage mural : une
 * bougie antérieure au curseur est passée pour tous les instruments. Il est
 * écrit une seule fois, à la fin, avec le maximum atteint — l'écrire à chaque
 * symbole ferait sauter les bougies des suivants.
 */
export async function avancerTousLesInstruments(
  intervalle: string,
): Promise<ResultatTrading> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estIntervalle(intervalle)) return { ok: false, message: 'Intervalle inconnu.' };

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  const [{ data: enAttente }, { data: ouvertes }] = await Promise.all([
    client
      .from('ordres')
      .select('symboles(code)')
      .eq('profil_id', profilId)
      .in('statut', ['EN_ATTENTE', 'PARTIELLEMENT_REMPLI']),
    client
      .from('positions')
      .select('symboles(code)')
      .eq('profil_id', profilId)
      .eq('statut', 'OUVERTE'),
  ]);

  const codes = new Set<string>();
  for (const ligne of enAttente ?? []) if (ligne.symboles?.code) codes.add(ligne.symboles.code);
  for (const ligne of ouvertes ?? []) if (ligne.symboles?.code) codes.add(ligne.symboles.code);

  if (codes.size === 0) {
    return { ok: true, message: 'Aucun ordre en attente ni position ouverte à traiter.' };
  }

  let portefeuilleId: string | null = null;
  let curseurMaximal = 0;
  let bougiesTotal = 0;
  let evenementsTotal = 0;
  const incidents: string[] = [];

  for (const code of codes) {
    try {
      const marche = await contexteDepuisMarche(client, profilId, code, intervalle);
      if (!marche.ok) {
        incidents.push(`${code} : ${marche.message}`);
        continue;
      }

      const persiste = await chargerEtat(client, profilId, code);
      if (!persiste) continue;
      if (persiste.etat.portefeuille.gele) {
        return { ok: false, message: 'Portefeuille gelé : le moteur est à l’arrêt.' };
      }

      portefeuilleId = persiste.portefeuilleId;
      const derniereTraitee = persiste.dernierHorodatageTraite ?? 0;
      const aTraiter = marche.chandeliers.filter(
        (chandelier) => chandelier.horodatage > derniereTraitee,
      );
      if (aTraiter.length === 0) continue;

      let etat = persiste.etat;
      for (const chandelier of aTraiter) {
        const contexte: ContexteBougie = { ...marche.contexte, bougie: chandelier };
        const resultat = traiterBougie(etat, contexte);
        etat = resultat.etat;
        evenementsTotal += resultat.evenements.length;

        if (resultat.evenements.length > 0 || resultat.ecritures.length > 0) {
          await appliquerResultat(
            client,
            { profilId, portefeuilleId: persiste.portefeuilleId, symboleId: marche.symboleId },
            resultat,
            chandelier.horodatage,
          );
        }
      }

      const derniere = aTraiter[aTraiter.length - 1]!;
      bougiesTotal += aTraiter.length;
      curseurMaximal = Math.max(curseurMaximal, derniere.horodatage);

      await reevaluerOuvertes(
        client,
        { ...marche.contexte, bougie: derniere },
        marche.contexte.tauxCotationVersCompte,
        etat.positions,
      );

      await client
        .from('portefeuilles')
        .update({
          solde: etat.portefeuille.solde,
          equite: etat.portefeuille.equite,
          marge_utilisee: etat.portefeuille.margeUtilisee,
          sommet_equite: etat.portefeuille.sommetEquite,
        })
        .eq('id', persiste.portefeuilleId);
    } catch (erreur) {
      // Un instrument indisponible ne doit pas empêcher les autres d'avancer :
      // c'est exactement la situation où un ordre resterait bloqué sans que
      // personne ne le sache.
      incidents.push(`${code} : ${erreur instanceof Error ? erreur.message : 'erreur inconnue'}`);
    }
  }

  if (portefeuilleId && curseurMaximal > 0) {
    await client
      .from('portefeuilles')
      .update({ dernier_horodatage_traite: curseurMaximal })
      .eq('id', portefeuilleId);
  }

  revalidatePath('/salle-des-marches');

  const resume = `${codes.size} instrument(s), ${bougiesTotal} bougie(s), ${evenementsTotal} événement(s).`;
  return {
    ok: true,
    message: incidents.length > 0 ? `${resume} Non traités — ${incidents.join(' ; ')}` : resume,
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
