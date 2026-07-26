import type {
  ContexteBougie,
  EtatMoteur,
  EtatPortefeuille,
  Instrument,
  ParametresSimulation,
} from '@/lib/execution/types';
import { SIMULATION_DEFAUT } from '@/lib/execution/types';
import type { Chandelier } from '@/lib/marche/types';

/** Instruments et états de départ partagés par les tests d'exécution. */

export const EURUSD: Instrument = {
  code: 'EURUSD',
  classeActif: 'FOREX',
  deviseBase: 'EUR',
  deviseCotation: 'USD',
  tailleContrat: 100_000,
  pasCotation: 0.00001,
  decimales: 5,
  spreadDefautPoints: 10, // 1,0 pip
  commissionParLot: 7,
  swapLongPoints: -20,
  swapCourtPoints: 5,
  levierMax: 30,
  // Ouvert en continu : les tests d'horaires utilisent un instrument dédié.
  horairesSeance: {},
};

export const USDJPY: Instrument = {
  ...EURUSD,
  code: 'USDJPY',
  deviseBase: 'USD',
  deviseCotation: 'JPY',
  pasCotation: 0.001,
  decimales: 3,
  spreadDefautPoints: 10,
};

export const NAS100: Instrument = {
  code: 'NAS100',
  classeActif: 'INDICE',
  deviseBase: null,
  deviseCotation: 'USD',
  tailleContrat: 1,
  pasCotation: 0.25,
  decimales: 2,
  spreadDefautPoints: 4,
  commissionParLot: 0,
  swapLongPoints: 0,
  swapCourtPoints: 0,
  levierMax: 20,
  horairesSeance: {
    '1': [['13:30', '20:00']],
    '2': [['13:30', '20:00']],
    '3': [['13:30', '20:00']],
    '4': [['13:30', '20:00']],
    '5': [['13:30', '20:00']],
  },
};

export const PORTEFEUILLE_NEUF: EtatPortefeuille = {
  devise: 'USD',
  capitalInitial: 100_000,
  solde: 100_000,
  equite: 100_000,
  margeUtilisee: 0,
  sommetEquite: 100_000,
  gele: false,
};

export const ETAT_NEUF: EtatMoteur = {
  portefeuille: PORTEFEUILLE_NEUF,
  ordres: [],
  positions: [],
};

/** Simulation sans frottement, pour isoler la mécanique dans certains tests. */
export const SIMULATION_PARFAITE: ParametresSimulation = {
  ...SIMULATION_DEFAUT,
  slippageAtr: 0,
  slippageParLot: 0,
};

export function bougie(
  horodatage: number,
  ouverture: number,
  haut: number,
  bas: number,
  cloture: number,
  volume: number | null = 1000,
): Chandelier {
  return { horodatage, ouverture, haut, bas, cloture, volume };
}

export function contexte(
  chandelier: Chandelier,
  options: Partial<Omit<ContexteBougie, 'bougie'>> = {},
): ContexteBougie {
  return {
    instrument: options.instrument ?? EURUSD,
    intervalle: options.intervalle ?? 'M5',
    bougie: chandelier,
    atr: options.atr ?? null,
    // `??` transformerait un `null` explicite en 1, ce qui masquerait
    // justement le cas « taux inconnu » qu'on veut pouvoir tester.
    tauxCotationVersCompte:
      'tauxCotationVersCompte' in options ? (options.tauxCotationVersCompte ?? null) : 1,
    parametres: options.parametres ?? SIMULATION_PARFAITE,
  };
}
