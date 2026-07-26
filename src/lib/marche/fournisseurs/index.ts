import type { CodeFournisseur, FournisseurDonneesMarche } from '../types';

import { FournisseurMock } from './mock';
import { FournisseurTwelveData } from './twelvedata';
import { FournisseurYahoo } from './yahoo';

/**
 * Registre des adaptateurs livrés. Les codes absents d'ici (finnhub,
 * alphavantage, alpaca) existent déjà en base et dans l'UI, mais sans
 * implémentation : le routeur les ignore explicitement plutôt que de faire
 * comme s'ils fonctionnaient.
 */
const REGISTRE: Readonly<Partial<Record<CodeFournisseur, FournisseurDonneesMarche>>> = {
  mock: new FournisseurMock(),
  twelvedata: new FournisseurTwelveData(),
  yahoo: new FournisseurYahoo(),
};

export function fournisseur(code: CodeFournisseur): FournisseurDonneesMarche | undefined {
  return REGISTRE[code];
}

export function fournisseursImplementes(): readonly CodeFournisseur[] {
  return Object.keys(REGISTRE) as CodeFournisseur[];
}

export { FournisseurMock, FournisseurTwelveData, FournisseurYahoo };
