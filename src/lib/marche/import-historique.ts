import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import { ecrireCache } from './cache';
import { lireCle } from './cles';
import { fournisseur as adaptateur } from './fournisseurs';
import { dureeSecondes } from './intervalles';
import { consommerQuota, etatDepuisLigne } from './quotas';
import { verifierSerie, type Anomalie, type RapportQualite } from './qualite';
import { chargerSymbole } from './symboles';
import type { Chandelier, CodeFournisseur, Intervalle } from './types';

type Client = SupabaseClient<Database>;

/**
 * Import d'historique profond.
 *
 * Le routeur ne sait servir qu'une chose : la fenêtre la plus récente. C'est
 * exactement ce qu'il faut pour décider maintenant, et exactement ce qui
 * interdit de remonter quinze ans — quel que soit le nombre d'appels, on
 * redemanderait toujours les mêmes bougies.
 *
 * Cette fonction remonte le temps par tranches, en reculant le curseur sur la
 * bougie la plus ancienne obtenue. Elle est délibérément séparée du routeur :
 * ce sont deux métiers différents. Le routeur optimise la fraîcheur et bascule
 * de fournisseur au moindre incident ; un import doit au contraire s'en tenir à
 * **une seule source** du début à la fin, sinon la série reconstituée est un
 * collage de deux référentiels de prix.
 *
 * Trois garde-fous, tous nécessaires :
 *
 *  1. **Détection d'absence de progrès.** Un fournisseur qui ignore la fenêtre
 *     demandée renvoie éternellement la même tranche. Sans cette détection, la
 *     boucle brûlerait le quota de la journée en quelques secondes.
 *  2. **Plafond d'appels.** Explicite, jamais implicite : on sait avant de
 *     lancer combien de requêtes on accepte de dépenser.
 *  3. **Quota partagé.** Le même compteur que le trafic courant. Un import ne
 *     doit pas laisser la salle des marchés sans données pour le reste du jour.
 */

export interface OptionsImport {
  readonly client: Client;
  readonly profilId: string;
  /** Code interne (EURUSD, XAUUSD…). */
  readonly symbole: string;
  readonly intervalle: Intervalle;
  /** Cible : on remonte jusqu'à cet instant (secondes UTC). */
  readonly depuis: number;
  /** Source imposée. À défaut, le premier fournisseur actif capable de remonter. */
  readonly fournisseur?: CodeFournisseur;
  /** Plafond de requêtes pour cet import. */
  readonly appelsMax?: number;
  readonly maintenant?: number;
  readonly signal?: AbortSignal;
}

export type RaisonArret =
  | 'CIBLE_ATTEINTE'
  | 'PLAFOND_APPELS'
  | 'QUOTA_EPUISE'
  | 'SOURCE_TARIE'
  | 'AUCUN_PROGRES'
  | 'ERREUR_FOURNISSEUR'
  | 'INTERROMPU';

export interface RapportImport {
  readonly ok: boolean;
  readonly fournisseur: CodeFournisseur | null;
  readonly appels: number;
  readonly bougiesEcrites: number;
  /** Bornes réellement obtenues, pas celles demandées. */
  readonly plusAncienne: number | null;
  readonly plusRecente: number | null;
  readonly raisonArret: RaisonArret;
  readonly anomalies: readonly Anomalie[];
  readonly message: string;
}

const EXPLICATIONS: Readonly<Record<RaisonArret, string>> = {
  CIBLE_ATTEINTE: 'profondeur demandée atteinte.',
  PLAFOND_APPELS: 'plafond d’appels atteint, relancer pour continuer.',
  QUOTA_EPUISE: 'quota du fournisseur épuisé, reprendre après réinitialisation.',
  SOURCE_TARIE: 'le fournisseur ne remonte pas plus loin sur ce palier.',
  AUCUN_PROGRES: 'le fournisseur ne recule plus : fenêtre historique non honorée.',
  ERREUR_FOURNISSEUR: 'interrompu par une erreur.',
  INTERROMPU: 'interrompu à la demande.',
};

const APPELS_MAX_DEFAUT = 40;
/** Au-delà, on considère que la source ne remonte pas plus loin. */
const TRANCHES_VIDES_TOLEREES = 1;

export async function importerHistorique(options: OptionsImport): Promise<RapportImport> {
  const maintenant = options.maintenant ?? Math.floor(Date.now() / 1000);
  const appelsMax = options.appelsMax ?? APPELS_MAX_DEFAUT;

  const symbole = await chargerSymbole(options.client, options.symbole);
  if (!symbole) {
    return echec(`Symbole « ${options.symbole} » absent du référentiel.`);
  }

  const choix = await choisirSource(options, symbole.correspondances);
  if ('erreur' in choix) return echec(choix.erreur);

  const { code, ligneQuota } = choix;
  const implementation = adaptateur(code)!;
  const symboleExterne = symbole.correspondances[code]!;
  const capacites = implementation.capacites();
  const cle = capacites.necessiteCle
    ? ((await lireCle(options.client, options.profilId, code)) ?? undefined)
    : undefined;

  if (capacites.necessiteCle && !cle) {
    return echec(`Aucune clé pour ${code} : import impossible.`, code);
  }
  if (!capacites.intervalles.includes(options.intervalle)) {
    return echec(`${code} ne publie pas l'intervalle ${options.intervalle}.`, code);
  }

  const duree = dureeSecondes(options.intervalle);
  const quotaDepart = etatDepuisLigne(ligneQuota, new Date(maintenant * 1000));
  const anomalies: Anomalie[] = [];
  let curseur = maintenant;
  let appels = 0;
  let bougiesEcrites = 0;
  let plusAncienne: number | null = null;
  let plusRecente: number | null = null;
  let vides = 0;
  let raison: RaisonArret = 'CIBLE_ATTEINTE';

  while (curseur > options.depuis) {
    if (appels >= appelsMax) {
      raison = 'PLAFOND_APPELS';
      break;
    }
    if (options.signal?.aborted) {
      raison = 'INTERROMPU';
      break;
    }

    // Le quota est lu une fois puis suivi localement. Le relire à chaque tour
    // rendrait la ligne consommée par nos propres appels — mais surtout,
    // s'appuyer sur la valeur initiale sans y ajouter `appels` ferait un
    // contrôle décoratif : la ligne ne bougerait jamais et la boucle ne
    // s'arrêterait qu'au plafond d'appels, quitte à vider le quota du jour.
    if (quotaDepart.limite !== null && quotaDepart.utilise + appels >= quotaDepart.limite) {
      raison = 'QUOTA_EPUISE';
      break;
    }

    let tranche: readonly Chandelier[];
    try {
      const reponse = await implementation.recupererChandeliers(
        {
          symbole: symbole.code,
          classeActif: symbole.classeActif,
          intervalle: options.intervalle,
          limite: capacites.limiteParAppel,
          avant: curseur,
        },
        { cle, symboleExterne, signal: options.signal },
      );
      tranche = reponse.chandeliers;
    } catch (erreur) {
      return {
        ...rapportPartiel(),
        ok: bougiesEcrites > 0,
        raisonArret: 'ERREUR_FOURNISSEUR',
        message:
          `${bougiesEcrites} bougies importées avant l'échec de ${code} : ` +
          (erreur instanceof Error ? erreur.message : 'échec inconnu.'),
      };
    }
    appels += 1;
    await consommerQuota(options.client, options.profilId, code, new Date(maintenant * 1000));

    // On ne garde que ce qui précède réellement le curseur : un fournisseur qui
    // arrondit sa date de fin peut rendre la bougie déjà écrite au tour d'avant.
    const utiles = tranche
      .filter((bougie) => bougie.horodatage < curseur && bougie.horodatage >= options.depuis)
      .sort((a, b) => a.horodatage - b.horodatage);

    if (utiles.length === 0) {
      vides += 1;
      if (vides > TRANCHES_VIDES_TOLEREES) {
        raison = tranche.length === 0 ? 'SOURCE_TARIE' : 'AUCUN_PROGRES';
        break;
      }
      // Une tranche vide peut n'être qu'un long week-end ou un jour férié :
      // on recule d'une largeur de fenêtre et on retente une fois.
      curseur -= duree * capacites.limiteParAppel;
      continue;
    }
    vides = 0;

    const rapport = verifierSerie(utiles, {
      intervalle: options.intervalle,
      classeActif: symbole.classeActif,
      maintenant,
    });
    anomalies.push(...rapport.anomalies);

    // Une tranche bloquante n'est pas écrite : mieux vaut un trou signalé
    // qu'une bougie fausse indistinguable des bonnes une fois en base.
    if (!rapport.exploitable) {
      return {
        ...rapportPartiel(),
        ok: bougiesEcrites > 0,
        raisonArret: 'ERREUR_FOURNISSEUR',
        message: `Tranche rejetée par le contrôle qualité : ${premiereBloquante(rapport)}`,
      };
    }

    await ecrireCache(options.client, symbole.id, options.intervalle, code, utiles, maintenant);
    bougiesEcrites += utiles.length;

    const debutTranche = utiles[0]!.horodatage;
    const finTranche = utiles[utiles.length - 1]!.horodatage;
    plusAncienne = plusAncienne === null ? debutTranche : Math.min(plusAncienne, debutTranche);
    plusRecente = plusRecente === null ? finTranche : Math.max(plusRecente, finTranche);

    if (debutTranche >= curseur) {
      raison = 'AUCUN_PROGRES';
      break;
    }
    curseur = debutTranche;
  }

  return { ...rapportPartiel(), ok: bougiesEcrites > 0, raisonArret: raison, message: resumer() };

  function rapportPartiel() {
    return {
      ok: false,
      fournisseur: code,
      appels,
      bougiesEcrites,
      plusAncienne,
      plusRecente,
      raisonArret: 'CIBLE_ATTEINTE' as RaisonArret,
      anomalies,
      message: '',
    };
  }

  function resumer(): string {
    const periode =
      plusAncienne === null
        ? 'aucune période couverte'
        : `du ${jour(plusAncienne)} au ${jour(plusRecente!)}`;
    return `${bougiesEcrites} bougies ${symbole!.code} ${options.intervalle} depuis ${code}, ${periode}, ${appels} appel${appels > 1 ? 's' : ''} — ${EXPLICATIONS[raison]}`;
  }
}

interface SourceChoisie {
  readonly code: CodeFournisseur;
  readonly ligneQuota: Parameters<typeof etatDepuisLigne>[0];
}

/**
 * Une seule source pour tout l'import, et elle doit savoir remonter le temps.
 * Basculer en cours de route recollerait deux référentiels de prix — le défaut
 * même qu'on cherche à éliminer.
 */
async function choisirSource(
  options: OptionsImport,
  correspondances: Readonly<Partial<Record<CodeFournisseur, string>>>,
): Promise<SourceChoisie | { erreur: string }> {
  const { data } = await options.client
    .from('fournisseurs_donnees')
    .select(
      'code, actif, quota_limite, quota_utilise, fenetre_quota, quota_reinitialise_le, priorite_par_classe',
    )
    .eq('profil_id', options.profilId)
    .eq('actif', true);

  const lignes = data ?? [];
  const eligibles = lignes.filter((ligne) => {
    const code = ligne.code as CodeFournisseur;
    if (options.fournisseur && code !== options.fournisseur) return false;
    const implementation = adaptateur(code);
    if (!implementation) return false;
    if (!implementation.capacites().fenetreHistorique) return false;
    return correspondances[code] !== undefined;
  });

  const retenue = eligibles[0];
  if (!retenue) {
    if (options.fournisseur) {
      return {
        erreur: `${options.fournisseur} n’est pas actif, ou ne sait pas remonter l’historique, ou n’a pas de correspondance pour ce symbole.`,
      };
    }
    return {
      erreur:
        'Aucun fournisseur actif ne sait remonter l’historique pour ce symbole. Twelve Data le sait : activez-le dans Réglages → Fournisseurs.',
    };
  }

  return { code: retenue.code as CodeFournisseur, ligneQuota: retenue };
}

function premiereBloquante(rapport: RapportQualite): string {
  const bloquante = rapport.anomalies.find((anomalie) => anomalie.gravite === 'BLOQUANTE');
  return bloquante ? `${bloquante.code} — ${bloquante.detail}` : 'anomalie bloquante.';
}

function jour(secondes: number): string {
  return new Date(secondes * 1000).toISOString().slice(0, 10);
}

function echec(message: string, code: CodeFournisseur | null = null): RapportImport {
  return {
    ok: false,
    fournisseur: code,
    appels: 0,
    bougiesEcrites: 0,
    plusAncienne: null,
    plusRecente: null,
    raisonArret: 'ERREUR_FOURNISSEUR',
    anomalies: [],
    message,
  };
}
