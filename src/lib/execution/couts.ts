import type { ContexteBougie, Instrument, Sens } from './types';

/**
 * Coûts d'exécution.
 *
 * Un paper trading qui remplit au prix affiché, sans spread ni slippage,
 * produit des courbes flatteuses et inutiles. Tout ce qui suit existe pour que
 * le résultat simulé ressemble à ce qu'un courtier aurait réellement donné.
 */

/** Valeur d'un point de cotation pour 1 lot, en devise de cotation. */
export function valeurPoint(instrument: Instrument): number {
  return instrument.pasCotation * instrument.tailleContrat;
}

/** Demi-spread en unités de prix : le prix affiché est le milieu. */
export function demiSpread(instrument: Instrument): number {
  return (instrument.spreadDefautPoints * instrument.pasCotation) / 2;
}

/**
 * Slippage : proportionnel à la volatilité et à la taille.
 *
 * Sans composante ATR, un backtest ferait passer les mêmes ordres au même prix
 * en séance calme et en pleine publication de chiffres macro. Sans composante
 * de taille, on pourrait « exécuter » 50 lots au prix de 1.
 */
export function slippage(contexte: ContexteBougie, quantiteLots: number): number {
  const { parametres, instrument, atr } = contexte;

  // Quand l'ATR n'est pas encore calculable, on lui substitue un ordre de
  // grandeur tiré du spread — mais la substitution reste **multipliée par le
  // paramètre**. Une version antérieure renvoyait le repli tel quel, si bien
  // que régler le slippage à zéro n'avait aucun effet tant qu'aucun ATR
  // n'était disponible : un paramètre qui ne paramètre rien.
  const volatiliteReference =
    atr !== null && atr > 0 ? atr : instrument.spreadDefautPoints * instrument.pasCotation * 5;

  const composanteVolatilite = volatiliteReference * parametres.slippageAtr;

  const surTaille = Math.max(0, quantiteLots - parametres.tailleReferenceLots);
  const composanteTaille = surTaille * parametres.slippageParLot * composanteVolatilite;

  return composanteVolatilite + composanteTaille;
}

/**
 * Prix effectif d'exécution : le milieu, plus le demi-spread et le slippage,
 * toujours **en défaveur** de celui qui passe l'ordre.
 */
export function prixExecution(
  prixMilieu: number,
  sens: Sens,
  contexte: ContexteBougie,
  quantiteLots: number,
): number {
  const penalite = demiSpread(contexte.instrument) + slippage(contexte, quantiteLots);
  const brut = sens === 'ACHAT' ? prixMilieu + penalite : prixMilieu - penalite;
  return arrondirAuPas(brut, contexte.instrument);
}

export function arrondirAuPas(prix: number, instrument: Instrument): number {
  const pas = instrument.pasCotation;
  return Number((Math.round(prix / pas) * pas).toFixed(instrument.decimales + 2));
}

export function commission(instrument: Instrument, quantiteLots: number): number {
  return instrument.commissionParLot * quantiteLots;
}

/**
 * Frais de portage. Négatif = débit. Les points de swap sont exprimés dans la
 * cotation de l'instrument, donc convertis comme un P&L.
 */
export function swap(
  instrument: Instrument,
  sens: Sens,
  quantiteLots: number,
  nombreNuits: number,
  tauxCotationVersCompte: number,
): number {
  const points = sens === 'ACHAT' ? instrument.swapLongPoints : instrument.swapCourtPoints;
  return points * valeurPoint(instrument) * quantiteLots * nombreNuits * tauxCotationVersCompte;
}

/** Résultat d'une position, dans la devise du portefeuille. */
export function profitPerte(
  instrument: Instrument,
  sens: Sens,
  quantiteLots: number,
  prixEntree: number,
  prixSortie: number,
  tauxCotationVersCompte: number,
): number {
  const variation = sens === 'ACHAT' ? prixSortie - prixEntree : prixEntree - prixSortie;
  return variation * instrument.tailleContrat * quantiteLots * tauxCotationVersCompte;
}

/**
 * Taux de conversion de la devise de cotation vers celle du portefeuille.
 *
 * Renvoie `null` quand il faudrait une cotation tierce (EUR/GBP sur un compte
 * en dollars, par exemple). Le moteur refuse alors l'ordre : compter un P&L en
 * yens comme s'il s'agissait de dollars donnerait une comptabilité fausse de
 * deux ordres de grandeur, sans rien signaler.
 */
export function tauxConversion(
  instrument: Instrument,
  prixCourant: number,
  deviseCompte: string,
): number | null {
  if (instrument.deviseCotation === deviseCompte) return 1;
  // Paires du type USD/JPY sur un compte en USD : 1 JPY vaut 1/prix USD.
  if (instrument.deviseBase === deviseCompte && prixCourant > 0) return 1 / prixCourant;
  return null;
}
