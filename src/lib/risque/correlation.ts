import type { ClasseActif } from '@/lib/marche/types';

/**
 * Estimation de corrélation entre deux expositions.
 *
 * Heuristique assumée, pas une mesure : tant qu'il n'y a pas d'historique de
 * rendements (phase 6), calculer une vraie corrélation est impossible. Mais
 * renoncer en attendant reviendrait à autoriser cinq fois le même pari sous
 * cinq noms différents — c'est cette estimation qui alimente la matrice du
 * risque agrégé (`portefeuille.ts`) et la contrainte de concentration
 * (`concentration.ts`).
 *
 * Pour le Forex et les matières premières cotées en devise, on raisonne sur
 * l'exposition aux devises : acheter EUR/USD, c'est être long EUR et short USD.
 * La similarité cosinus de ces vecteurs capture correctement les cas qui
 * comptent — EUR/USD et GBP/USD dans le même sens sont corrélés, EUR/USD long
 * et USD/CHF long le sont négativement.
 */

export interface ExpositionPosition {
  readonly instrument: string;
  readonly classeActif: ClasseActif;
  readonly deviseBase: string | null;
  readonly deviseCotation: string;
  readonly sens: 'ACHAT' | 'VENTE';
}

/** Corrélation par défaut entre deux instruments d'une même classe. */
const CORRELATION_MEME_CLASSE: Readonly<Record<ClasseActif, number>> = {
  FOREX: 0,
  INDICE: 0.85,
  ACTION: 0.6,
  CRYPTO: 0.8,
  MATIERE_PREMIERE: 0.5,
};

function vecteurDevises(exposition: ExpositionPosition): Map<string, number> {
  const signe = exposition.sens === 'ACHAT' ? 1 : -1;
  const vecteur = new Map<string, number>();
  if (exposition.deviseBase) vecteur.set(exposition.deviseBase, signe);
  vecteur.set(exposition.deviseCotation, (vecteur.get(exposition.deviseCotation) ?? 0) - signe);
  return vecteur;
}

function cosinus(a: Map<string, number>, b: Map<string, number>): number {
  let produit = 0;
  let normeA = 0;
  let normeB = 0;

  for (const valeur of a.values()) normeA += valeur * valeur;
  for (const valeur of b.values()) normeB += valeur * valeur;
  for (const [devise, valeur] of a) produit += valeur * (b.get(devise) ?? 0);

  if (normeA === 0 || normeB === 0) return 0;
  return produit / (Math.sqrt(normeA) * Math.sqrt(normeB));
}

export function correlationEstimee(a: ExpositionPosition, b: ExpositionPosition): number {
  if (a.instrument === b.instrument) {
    return a.sens === b.sens ? 1 : -1;
  }

  const parDevises =
    (a.classeActif === 'FOREX' || a.classeActif === 'MATIERE_PREMIERE') &&
    (b.classeActif === 'FOREX' || b.classeActif === 'MATIERE_PREMIERE');

  if (parDevises && a.deviseBase && b.deviseBase) {
    return cosinus(vecteurDevises(a), vecteurDevises(b));
  }

  if (a.classeActif === b.classeActif) {
    const base = CORRELATION_MEME_CLASSE[a.classeActif];
    return a.sens === b.sens ? base : -base;
  }

  return 0;
}

/**
 * Corrélation entre deux instruments, **indépendamment du sens**.
 *
 * `correlationEstimee` mélange deux choses : la parenté des sous-jacents et le
 * sens des positions. C'est commode pour un compteur, mais inutilisable dans
 * une matrice — l'agrégation du risque a besoin de la corrélation du couple
 * d'instruments, et applique le sens séparément par le signe de l'exposition.
 * Les confondre reviendrait à compter le sens deux fois.
 */
export function correlationInstruments(
  a: Omit<ExpositionPosition, 'sens'>,
  b: Omit<ExpositionPosition, 'sens'>,
): number {
  return correlationEstimee({ ...a, sens: 'ACHAT' }, { ...b, sens: 'ACHAT' });
}

/**
 * Corrélation de Pearson entre deux séries de rendements.
 *
 * C'est la mesure, par opposition à l'heuristique par vecteurs de devises.
 * Elle exige un historique aligné : deux séries de longueurs différentes sont
 * tronquées à la plus courte **par la fin**, parce que ce sont les bougies
 * récentes qui comptent — une corrélation d'il y a trois ans ne dit rien du
 * régime actuel.
 *
 * Rend `null` plutôt qu'un zéro trompeur quand l'échantillon est trop court ou
 * qu'une série ne bouge pas : un zéro serait lu comme « décorrélé », ce qui
 * autoriserait deux fois le même pari.
 */
export function correlationMesuree(
  a: readonly number[],
  b: readonly number[],
  minimum = 30,
): number | null {
  const taille = Math.min(a.length, b.length);
  if (taille < minimum) return null;

  const x = a.slice(a.length - taille);
  const y = b.slice(b.length - taille);

  const moyenneX = x.reduce((total, valeur) => total + valeur, 0) / taille;
  const moyenneY = y.reduce((total, valeur) => total + valeur, 0) / taille;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (let index = 0; index < taille; index += 1) {
    const ecartX = x[index]! - moyenneX;
    const ecartY = y[index]! - moyenneY;
    covariance += ecartX * ecartY;
    varianceX += ecartX * ecartX;
    varianceY += ecartY * ecartY;
  }

  if (!(varianceX > 0) || !(varianceY > 0)) return null;

  const rho = covariance / Math.sqrt(varianceX * varianceY);
  // Les erreurs d'arrondi peuvent sortir de [-1, 1] au millionième près, et
  // une corrélation supérieure à 1 rendrait la matrice non définie positive.
  return Math.max(-1, Math.min(1, rho));
}

/** Rendements logarithmiques d'une série de clôtures. */
export function rendementsLog(clotures: readonly number[]): number[] {
  const rendements: number[] = [];
  for (let index = 1; index < clotures.length; index += 1) {
    const avant = clotures[index - 1]!;
    const apres = clotures[index]!;
    if (avant > 0 && apres > 0) rendements.push(Math.log(apres / avant));
  }
  return rendements;
}
