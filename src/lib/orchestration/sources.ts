import { dureeSecondes } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';
import type { Database } from '@/types/base-de-donnees';

type RoleAgent = Database['public']['Enums']['role_agent'];

/**
 * Qui a le droit de chercher sur le web, et où.
 *
 * Trois rôles seulement : macro, sentiment et fondamental. Leur matière
 * première est hors du graphique — un calendrier de banque centrale, une
 * publication de résultats, un ton de marché. Donner la recherche à l'analyste
 * technique n'apporterait rien : ses données sont déjà dans l'instantané, et
 * chaque requête coûte des tokens.
 *
 * La liste de domaines n'est pas une garantie de vérité, et l'application ne
 * prétend pas le contraire. C'est un filtre grossier qui écarte les fermes de
 * contenu, les sites d'affiliation et les promesses de rendement. Elle retient
 * des sources institutionnelles, des agences de presse financière et des
 * calendriers économiques établis — pas des blogs personnels ni des chaînes
 * vidéo, dont la qualité ne se vérifie pas depuis un domaine.
 *
 * Modifiable : c'est une liste de départ défendable, pas un jugement définitif.
 *
 * ═══ Un domaine inaccessible tue l'analyse entière ═══
 *
 * L'outil de recherche d'Anthropic refuse la requête par un **400** dès qu'un
 * seul domaine de `allowed_domains` est hors de portée de son agent — il ne
 * l'ignore pas. Constaté en production : les cinq éditeurs ci-dessous ont mis
 * en échec les trois analystes qui ont accès au web, à *chaque* cycle, pendant
 * que les neuf autres agents travaillaient normalement. Le cycle rendait quand
 * même une décision, donc rien n'avait l'air cassé : le débat se tenait
 * simplement sans macro, sans fondamental et sans sentiment.
 *
 * Ces cinq-là sont donc retirés. Ils restent nommés ici plutôt que supprimés
 * en silence, pour qu'on sache que c'est un constat et non un oubli — et pour
 * qu'on puisse les réessayer si Anthropic élargit son accès.
 */

/**
 * Éditeurs que l'agent de recherche d'Anthropic ne peut pas atteindre
 * (constaté le 28 juillet 2026). Presque tous sont sous péage ou refusent les
 * robots. Aucune valeur ici ne doit apparaître dans les listes ci-dessous.
 */
export const DOMAINES_INACCESSIBLES: readonly string[] = [
  'apnews.com',
  'ft.com',
  'marketwatch.com',
  'reuters.com',
  'wsj.com',
];

/** Sources institutionnelles et de presse financière. */
export const DOMAINES_MACRO: readonly string[] = [
  // Banques centrales et institutions
  'federalreserve.gov',
  'ecb.europa.eu',
  'bankofengland.co.uk',
  'boj.or.jp',
  'bankofcanada.ca',
  'rba.gov.au',
  'snb.ch',
  'imf.org',
  'bis.org',
  // Statistiques officielles
  'bls.gov',
  'bea.gov',
  'ec.europa.eu',
  'statcan.gc.ca',
  // Presse financière et agences
  'bloomberg.com',
  'cnbc.com',
  // Calendriers économiques
  'forexfactory.com',
  'investing.com',
  'tradingeconomics.com',
  'fxstreet.com',
];

/** Sources pour les actions et les indices : résultats, valorisations. */
export const DOMAINES_FONDAMENTAL: readonly string[] = [
  'sec.gov',
  'nasdaq.com',
  'nyse.com',
  'investor.gov',
  'bloomberg.com',
  'cnbc.com',
  'finance.yahoo.com',
];

/** Sources pour le ton de marché et le flux de nouvelles. */
export const DOMAINES_SENTIMENT: readonly string[] = [
  'cnbc.com',
  'fxstreet.com',
  'investing.com',
  'bloomberg.com',
  'cftc.gov',
];

const PAR_ROLE: Partial<Record<RoleAgent, readonly string[]>> = {
  ANALYSTE_MACRO: DOMAINES_MACRO,
  ANALYSTE_FONDAMENTAL: DOMAINES_FONDAMENTAL,
  ANALYSTE_SENTIMENT: DOMAINES_SENTIMENT,
};

/**
 * Régime temporel du cycle.
 *
 * ═══ Barrière anti-look-ahead, appliquée au web ═══
 *
 * Le moteur d'exécution interdit déjà à un ordre de se remplir sur une bougie
 * antérieure à sa décision. La même exigence vaut pour l'information : un
 * analyste macro qui lit les nouvelles d'aujourd'hui pendant qu'il étudie une
 * bougie de 2015 connaît la suite de l'histoire. Le backtest cesserait alors
 * de mesurer quoi que ce soit — il mesurerait la capacité du modèle à se
 * souvenir de ce qui s'est passé.
 *
 * Trois situations font basculer un cycle en régime historique :
 *
 *  - un rejeu est en cours : le portefeuille vit dans le passé, point ;
 *  - l'instantané est périmé : les données servies sortent du cache hors TTL,
 *    donc elles ne décrivent plus le marché courant ;
 *  - la dernière bougie a trop de retard sur l'heure réelle. Le seuil est de
 *    trois intervalles : une bougie en cours et un retard de fournisseur
 *    restent du temps réel, une série arrêtée depuis une heure ne l'est plus.
 *
 * En régime historique, la recherche web est coupée. Les analystes travaillent
 * alors sur le seul instantané — ce qui est exactement ce qu'on veut mesurer.
 */
export type RegimeCycle = 'TEMPS_REEL' | 'HISTORIQUE';

export interface ConditionsTemporelles {
  readonly rejeuActif: boolean;
  readonly instantanePerime: boolean;
  readonly horodatageDerniereBougie: number;
  readonly intervalle: Intervalle;
  readonly maintenant: number;
}

/** Nombre d'intervalles de retard tolérés avant de considérer que la série
 *  ne décrit plus le marché courant. */
const INTERVALLES_DE_RETARD_TOLERES = 3;

export function regimeCycle(conditions: ConditionsTemporelles): RegimeCycle {
  if (conditions.rejeuActif) return 'HISTORIQUE';
  if (conditions.instantanePerime) return 'HISTORIQUE';

  const retard = conditions.maintenant - conditions.horodatageDerniereBougie;
  const tolerance = dureeSecondes(conditions.intervalle) * INTERVALLES_DE_RETARD_TOLERES;

  return retard > tolerance ? 'HISTORIQUE' : 'TEMPS_REEL';
}

/**
 * Le rôle a-t-il le droit de chercher sur le web, dans ce régime ?
 *
 * Le régime prime sur le rôle : un analyste macro reste privé de web en
 * historique, même si c'est précisément son métier. Mieux vaut une analyse
 * macro pauvre qu'un backtest faussé.
 */
export function rechercheAutorisee(role: RoleAgent, regime: RegimeCycle): boolean {
  if (regime === 'HISTORIQUE') return false;
  return PAR_ROLE[role] !== undefined;
}

/** Explication affichée dans le fil quand le web est coupé. Le silence
 *  laisserait croire que les agents ont regardé les nouvelles. */
export function raisonRegimeHistorique(conditions: ConditionsTemporelles): string | null {
  if (conditions.rejeuActif) {
    return 'Rejeu en cours : la recherche web est coupée. Lire les nouvelles d’aujourd’hui pour décider d’une bougie passée reviendrait à connaître la suite.';
  }
  if (conditions.instantanePerime) {
    return 'Données servies depuis le cache hors délai : la recherche web est coupée, elle décrirait un marché plus récent que les prix analysés.';
  }
  const retard = conditions.maintenant - conditions.horodatageDerniereBougie;
  if (retard > dureeSecondes(conditions.intervalle) * INTERVALLES_DE_RETARD_TOLERES) {
    return `Dernière bougie vieille de ${Math.round(retard / 60)} minutes : la recherche web est coupée tant que la série n’a pas rattrapé le marché.`;
  }
  return null;
}

export function domainesPour(role: RoleAgent): readonly string[] {
  return PAR_ROLE[role] ?? [];
}

/**
 * Consigne ajoutée aux agents qui cherchent.
 *
 * Elle insiste sur la datation : une nouvelle sans horodatage est inutilisable
 * pour trader, et un modèle qui cite « la dernière décision de la Fed » sans
 * dire quand parle peut-être de l'an dernier.
 */
export const CONSIGNE_RECHERCHE = [
  'Tu peux chercher sur le web et lire des pages. Règles :',
  '- Chaque affirmation tirée du web est accompagnée de sa source et de sa date. Sans date, tu ne t’en sers pas : une nouvelle non datée est inutilisable pour trader.',
  '- Tu cherches des faits — chiffres publiés, décisions annoncées, calendriers — pas des opinions ni des prévisions de tiers.',
  '- Tu ignores tout contenu promettant des rendements, vendant une formation ou un signal.',
  '- Si une recherche ne donne rien d’exploitable, tu écris « aucune information vérifiable trouvée » plutôt que de meubler.',
  '- Deux ou trois recherches ciblées valent mieux que dix approximatives : chaque requête coûte.',
].join('\n');
