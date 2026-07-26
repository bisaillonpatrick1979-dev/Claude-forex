import type { EtatPortefeuille, Instrument, ParametresSimulation, PositionOuverte } from './types';

/**
 * Marge et levier.
 *
 * Le levier retenu est le plus prudent entre celui de l'instrument et le
 * plafond maison : peu importe ce qu'un courtier autoriserait, la limite du
 * projet s'applique.
 */
export function levierEffectif(instrument: Instrument, parametres: ParametresSimulation): number {
  return Math.min(instrument.levierMax, parametres.levierMax);
}

/** Valeur notionnelle d'une position, dans la devise du portefeuille. */
export function valeurNotionnelle(
  instrument: Instrument,
  quantiteLots: number,
  prix: number,
  tauxCotationVersCompte: number,
): number {
  return instrument.tailleContrat * quantiteLots * prix * tauxCotationVersCompte;
}

export function margeRequise(
  instrument: Instrument,
  quantiteLots: number,
  prix: number,
  tauxCotationVersCompte: number,
  parametres: ParametresSimulation,
): number {
  return (
    valeurNotionnelle(instrument, quantiteLots, prix, tauxCotationVersCompte) /
    levierEffectif(instrument, parametres)
  );
}

export function margeLibre(portefeuille: EtatPortefeuille): number {
  return portefeuille.equite - portefeuille.margeUtilisee;
}

/**
 * Niveau de marge = équité / marge utilisée.
 * Sans position ouverte, il n'y a pas de niveau de marge : on rend `null`
 * plutôt que l'infini, pour que l'appelant ne compare pas un nombre inventé.
 */
export function niveauMarge(portefeuille: EtatPortefeuille): number | null {
  if (portefeuille.margeUtilisee <= 0) return null;
  return portefeuille.equite / portefeuille.margeUtilisee;
}

export function appelDeMarge(
  portefeuille: EtatPortefeuille,
  parametres: ParametresSimulation,
): boolean {
  const niveau = niveauMarge(portefeuille);
  return niveau !== null && niveau < parametres.niveauAppelMarge;
}

/**
 * Position liquidée en premier : la plus lourdement perdante.
 * C'est la règle de la majorité des courtiers, et la plus défavorable à
 * l'utilisateur — donc la bonne pour une simulation honnête.
 */
export function positionALiquider(
  positions: readonly PositionOuverte[],
  pnlLatentParPosition: ReadonlyMap<string, number>,
): PositionOuverte | null {
  let pire: PositionOuverte | null = null;
  let pirePnl = Number.POSITIVE_INFINITY;

  for (const position of positions) {
    const pnl = pnlLatentParPosition.get(position.id) ?? 0;
    if (pnl < pirePnl) {
      pirePnl = pnl;
      pire = position;
    }
  }

  return pire;
}
