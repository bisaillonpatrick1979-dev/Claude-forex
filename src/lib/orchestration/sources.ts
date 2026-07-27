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
 */

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
  'reuters.com',
  'apnews.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'cnbc.com',
  'marketwatch.com',
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
  'reuters.com',
  'bloomberg.com',
  'cnbc.com',
  'marketwatch.com',
  'finance.yahoo.com',
  'ft.com',
  'wsj.com',
];

/** Sources pour le ton de marché et le flux de nouvelles. */
export const DOMAINES_SENTIMENT: readonly string[] = [
  'reuters.com',
  'apnews.com',
  'cnbc.com',
  'marketwatch.com',
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

export function rechercheAutorisee(role: RoleAgent): boolean {
  return PAR_ROLE[role] !== undefined;
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
