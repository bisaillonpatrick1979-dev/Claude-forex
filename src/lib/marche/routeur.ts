import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import { ecrireCache, lireCache } from './cache';
import { lireCle } from './cles';
import { ErreurDonneesIndisponibles, ErreurFournisseur } from './erreurs';
import { fournisseur as adaptateur } from './fournisseurs';
import { consommerQuota, etatDepuisLigne, journaliserResultatFournisseur } from './quotas';
import { chargerSymbole, type Symbole } from './symboles';
import type {
  ClasseActif,
  CodeFournisseur,
  IncidentFournisseur,
  Intervalle,
  ResultatMarche,
} from './types';

type Client = SupabaseClient<Database>;

/**
 * Routeur de données de marché.
 *
 * Cascade, dans cet ordre, sans jamais sauter d'étape en silence :
 *   1. cache frais ;
 *   2. fournisseurs éligibles, par priorité croissante pour la classe d'actifs ;
 *   3. cache périmé, servi et **marqué comme périmé** ;
 *   4. erreur explicite listant chaque tentative et sa raison.
 *
 * Un fournisseur est éligible s'il est actif, implémenté, capable de
 * l'intervalle et de la classe d'actifs, connu pour ce symbole (correspondance
 * en base), dans son quota, et muni de sa clé quand il en demande une.
 */

export interface OptionsRoutage {
  readonly client: Client;
  readonly profilId: string;
  readonly symbole: string;
  readonly intervalle: Intervalle;
  readonly limite: number;
  /** Force l'appel au fournisseur même si le cache est frais. */
  readonly ignorerCache?: boolean;
  readonly maintenant?: number;
  readonly signal?: AbortSignal;
}

interface Candidat {
  readonly code: CodeFournisseur;
  readonly priorite: number;
  readonly symboleExterne: string;
  readonly necessiteCle: boolean;
}

const TENTATIVES_MAX = 3;
const ATTENTE_INITIALE_MS = 250;

export async function obtenirChandeliers(options: OptionsRoutage): Promise<ResultatMarche> {
  const maintenant = options.maintenant ?? Math.floor(Date.now() / 1000);
  const incidents: IncidentFournisseur[] = [];

  const symbole = await chargerSymbole(options.client, options.symbole);
  if (!symbole) {
    throw new ErreurDonneesIndisponibles(
      `Symbole « ${options.symbole} » absent du référentiel.`,
      [],
    );
  }

  const cache = await lireCache(
    options.client,
    symbole.id,
    options.intervalle,
    options.limite,
    maintenant,
  );

  if (!options.ignorerCache && cache.frais && cache.chandeliers.length >= options.limite) {
    return {
      chandeliers: cache.chandeliers,
      origine: 'CACHE',
      fournisseur: cache.fournisseur ?? 'mock',
      perime: false,
      retarde: true,
      incidents,
      recupereLe: cache.recupereLe ?? maintenant,
    };
  }

  const candidats = await candidatsEligibles(options, symbole, incidents);

  for (const candidat of candidats) {
    const implementation = adaptateur(candidat.code);
    if (!implementation) continue;

    const cle = candidat.necessiteCle
      ? await lireCle(options.client, options.profilId, candidat.code)
      : undefined;

    if (candidat.necessiteCle && !cle) {
      incidents.push({ fournisseur: candidat.code, raison: 'Aucune clé API enregistrée.' });
      continue;
    }

    const resultat = await tenterFournisseur(options, symbole, candidat, cle ?? undefined);

    if (resultat.type === 'echec') {
      incidents.push({ fournisseur: candidat.code, raison: resultat.raison });
      await journaliserResultatFournisseur(
        options.client,
        options.profilId,
        candidat.code,
        'ERREUR',
        resultat.raison,
      );
      continue;
    }

    await consommerQuota(options.client, options.profilId, candidat.code, new Date(maintenant * 1000));
    await journaliserResultatFournisseur(
      options.client,
      options.profilId,
      candidat.code,
      'OK',
      null,
    );
    await ecrireCache(
      options.client,
      symbole.id,
      options.intervalle,
      candidat.code,
      resultat.chandeliers,
      maintenant,
    );

    return {
      chandeliers: resultat.chandeliers,
      origine: 'FOURNISSEUR',
      fournisseur: candidat.code,
      perime: false,
      retarde: resultat.retarde,
      incidents,
      recupereLe: maintenant,
    };
  }

  // Dernier recours : du périmé, annoncé comme tel. Mieux qu'un écran vide,
  // à condition que l'UI le montre — d'où le drapeau `perime`.
  if (cache.chandeliers.length > 0) {
    return {
      chandeliers: cache.chandeliers,
      origine: 'CACHE_PERIME',
      fournisseur: cache.fournisseur ?? 'mock',
      perime: true,
      retarde: true,
      incidents,
      recupereLe: cache.recupereLe ?? maintenant,
    };
  }

  throw new ErreurDonneesIndisponibles(
    `Aucune source disponible pour ${options.symbole} en ${options.intervalle}.`,
    incidents,
  );
}

async function candidatsEligibles(
  options: OptionsRoutage,
  symbole: Symbole,
  incidents: IncidentFournisseur[],
): Promise<readonly Candidat[]> {
  const { data } = await options.client
    .from('fournisseurs_donnees')
    .select('code, actif, quota_limite, quota_utilise, fenetre_quota, quota_reinitialise_le, priorite_par_classe')
    .eq('profil_id', options.profilId)
    .eq('actif', true);

  if (!data) return [];

  const maintenantDate = new Date((options.maintenant ?? Math.floor(Date.now() / 1000)) * 1000);
  const candidats: Candidat[] = [];

  for (const ligne of data) {
    const code = ligne.code as CodeFournisseur;
    const implementation = adaptateur(code);
    if (!implementation) continue; // adaptateur non livré : on n'y touche pas

    const priorite = prioritePourClasse(ligne.priorite_par_classe, symbole.classeActif);
    if (priorite === null) continue; // non éligible pour cette classe d'actifs

    const symboleExterne = symbole.correspondances[code];
    if (!symboleExterne) {
      incidents.push({ fournisseur: code, raison: `Aucune correspondance pour ${symbole.code}.` });
      continue;
    }

    const capacites = implementation.capacites();
    if (!capacites.classesActifs.includes(symbole.classeActif)) {
      incidents.push({ fournisseur: code, raison: `Classe ${symbole.classeActif} non couverte.` });
      continue;
    }
    if (!capacites.intervalles.includes(options.intervalle)) {
      incidents.push({ fournisseur: code, raison: `Intervalle ${options.intervalle} non publié.` });
      continue;
    }

    const quota = etatDepuisLigne(ligne, maintenantDate);
    if (quota.epuise) {
      incidents.push({
        fournisseur: code,
        raison: `Quota épuisé (${quota.utilise}/${quota.limite ?? '∞'} par ${quota.fenetre.toLowerCase()}).`,
      });
      continue;
    }

    candidats.push({
      code,
      priorite,
      symboleExterne,
      necessiteCle: capacites.necessiteCle,
    });
  }

  return candidats.sort((a, b) => a.priorite - b.priorite);
}

/** `priorite_par_classe` est un jsonb libre : on le lit défensivement plutôt
 *  que de faire confiance à sa forme. */
function prioritePourClasse(valeur: unknown, classe: ClasseActif): number | null {
  if (typeof valeur !== 'object' || valeur === null) return null;
  const priorite = (valeur as Record<string, unknown>)[classe];
  return typeof priorite === 'number' && Number.isFinite(priorite) ? priorite : null;
}

type ResultatTentative =
  | { type: 'succes'; chandeliers: readonly import('./types').Chandelier[]; retarde: boolean }
  | { type: 'echec'; raison: string };

/**
 * Backoff exponentiel, mais seulement sur les erreurs qui peuvent passer :
  * réessayer un quota épuisé ou un symbole inconnu ne fait que gaspiller du
 * quota et du temps.
 */
async function tenterFournisseur(
  options: OptionsRoutage,
  symbole: Symbole,
  candidat: Candidat,
  cle: string | undefined,
): Promise<ResultatTentative> {
  const implementation = adaptateur(candidat.code);
  if (!implementation) return { type: 'echec', raison: 'Adaptateur absent.' };

  let derniereRaison = 'Échec inconnu.';

  for (let tentative = 0; tentative < TENTATIVES_MAX; tentative += 1) {
    try {
      const reponse = await implementation.recupererChandeliers(
        {
          symbole: symbole.code,
          classeActif: symbole.classeActif,
          intervalle: options.intervalle,
          limite: options.limite,
        },
        { cle, symboleExterne: candidat.symboleExterne, signal: options.signal },
      );

      if (reponse.chandeliers.length === 0) {
        return { type: 'echec', raison: 'Réponse sans bougie.' };
      }
      return { type: 'succes', chandeliers: reponse.chandeliers, retarde: reponse.retarde };
    } catch (erreur) {
      derniereRaison = erreur instanceof Error ? erreur.message : 'Échec inconnu.';

      const reessayable = erreur instanceof ErreurFournisseur ? erreur.reessayable : false;
      if (!reessayable || tentative === TENTATIVES_MAX - 1) {
        return { type: 'echec', raison: derniereRaison };
      }

      await patienter(ATTENTE_INITIALE_MS * 2 ** tentative);
    }
  }

  return { type: 'echec', raison: derniereRaison };
}

function patienter(millisecondes: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, millisecondes));
}
