import type { ClasseActif } from '@/lib/marche/types';

/**
 * Estimation de corrélation entre deux expositions.
 *
 * Heuristique assumée, pas une mesure : tant qu'il n'y a pas d'historique de
 * rendements (phase 6), calculer une vraie corrélation est impossible. Mais
 * refuser de plafonner les positions corrélées en attendant reviendrait à
 * autoriser cinq fois le même pari sous cinq noms différents.
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

/** Nombre de positions ouvertes fortement corrélées à celle proposée. */
export function compterCorrelees(
  proposee: ExpositionPosition,
  ouvertes: readonly ExpositionPosition[],
  seuil: number,
): number {
  return ouvertes.filter((ouverte) => correlationEstimee(proposee, ouverte) >= seuil).length;
}
