import type { Chandelier, ClasseActif, Intervalle } from '@/lib/marche/types';

export type Sens = 'ACHAT' | 'VENTE';
export type TypeOrdre = 'MARCHE' | 'LIMITE' | 'STOP';

/**
 * Instrument tel que le moteur d'exécution en a besoin. Reprend les colonnes de
 * la table `symboles` : le moteur ne relit jamais la base, on lui passe l'état.
 * C'est ce qui permet à la même implémentation de servir le papier et le
 * backtest.
 */
export interface Instrument {
  readonly code: string;
  readonly classeActif: ClasseActif;
  readonly deviseBase: string | null;
  readonly deviseCotation: string;
  /** Unités de devise de base pour 1 lot (100 000 en Forex, 1 en actions). */
  readonly tailleContrat: number;
  readonly pasCotation: number;
  readonly decimales: number;
  readonly spreadDefautPoints: number;
  /** Frais par lot, aller-retour compris, dans la devise du portefeuille. */
  readonly commissionParLot: number;
  readonly swapLongPoints: number;
  readonly swapCourtPoints: number;
  readonly levierMax: number;
  /** Plages d'ouverture en UTC, par jour de semaine (0 = dimanche). */
  readonly horairesSeance: Readonly<Record<string, readonly (readonly [string, string])[]>>;
}

export interface OrdreEnAttente {
  readonly id: string;
  readonly instrument: string;
  readonly sens: Sens;
  readonly type: TypeOrdre;
  readonly quantite: number;
  /** Prix demandé pour LIMITE et STOP ; ignoré pour MARCHE. */
  readonly prixDemande: number | null;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  /**
   * Horodatage de la bougie sur laquelle la décision a été prise.
   * Aucun remplissage ne peut avoir lieu sur cette bougie ni avant :
   * c'est la barrière anti-look-ahead, vérifiée par un test dédié.
   */
  readonly horodatageDecision: number;
  readonly valideJusqua: number | null;
  readonly quantiteRemplie: number;
}

export interface PositionOuverte {
  readonly id: string;
  readonly instrument: string;
  readonly sens: Sens;
  readonly quantite: number;
  readonly prixEntree: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly margeImmobilisee: number;
  readonly commissionTotale: number;
  readonly swapTotal: number;
  readonly ouvertLe: number;
  /** Dernier passage de rollover appliqué, pour ne pas facturer deux fois. */
  readonly dernierSwapLe: number | null;
}

export interface EtatPortefeuille {
  readonly devise: string;
  readonly capitalInitial: number;
  /** Résultat réalisé uniquement : le latent n'entre jamais dans le solde. */
  readonly solde: number;
  readonly equite: number;
  readonly margeUtilisee: number;
  readonly sommetEquite: number;
  readonly gele: boolean;
}

export interface EtatMoteur {
  readonly portefeuille: EtatPortefeuille;
  readonly ordres: readonly OrdreEnAttente[];
  readonly positions: readonly PositionOuverte[];
}

/** Paramètres de simulation, distincts de l'instrument : ils décrivent la
 *  qualité d'exécution supposée, pas le produit. */
export interface ParametresSimulation {
  /** Part de l'ATR répercutée en slippage sur un ordre de taille normale. */
  readonly slippageAtr: number;
  /** Slippage additionnel par lot au-delà de la taille de référence. */
  readonly slippageParLot: number;
  readonly tailleReferenceLots: number;
  /** Volume maximal absorbable par bougie, en lots. Au-delà : remplissage
   *  partiel. `null` = liquidité illimitée. */
  readonly liquiditeParBougie: number | null;
  readonly levierMax: number;
  /** Niveau de marge (équité / marge utilisée) déclenchant la liquidation. */
  readonly niveauAppelMarge: number;
}

export const SIMULATION_DEFAUT: ParametresSimulation = {
  slippageAtr: 0.05,
  slippageParLot: 0.02,
  tailleReferenceLots: 1,
  liquiditeParBougie: null,
  levierMax: 10,
  niveauAppelMarge: 0.5,
};

export interface ContexteBougie {
  readonly instrument: Instrument;
  readonly intervalle: Intervalle;
  readonly bougie: Chandelier;
  /** ATR courant, pour le slippage. `null` = pas encore calculable. */
  readonly atr: number | null;
  /**
   * Combien d'unités de la devise du portefeuille vaut 1 unité de devise de
   * cotation. `null` quand le taux est inconnu : le moteur refuse alors
   * d'ouvrir, plutôt que de compter en devise étrangère sans le dire.
   */
  readonly tauxCotationVersCompte: number | null;
  readonly parametres: ParametresSimulation;
}

export type MotifSortie =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'LIQUIDATION'
  | 'FERMETURE_MANUELLE'
  | 'FERMETURE_AGENT';

export type TypeEvenement =
  | 'ORDRE_REMPLI'
  | 'ORDRE_PARTIELLEMENT_REMPLI'
  | 'ORDRE_EXPIRE'
  | 'ORDRE_REJETE'
  | 'POSITION_OUVERTE'
  | 'POSITION_FERMEE'
  | 'APPEL_MARGE'
  | 'SWAP_APPLIQUE';

export interface Evenement {
  readonly type: TypeEvenement;
  readonly horodatage: number;
  readonly ordreId?: string;
  readonly positionId?: string;
  readonly quantite?: number;
  readonly prix?: number;
  readonly montant?: number;
  readonly motif?: MotifSortie | string;
  readonly detail: string;
}

/** Écriture au grand livre. Toute variation de solde en passe par une. */
export interface Ecriture {
  readonly type: 'COMMISSION' | 'SWAP' | 'PROFIT_PERTE';
  readonly horodatage: number;
  readonly montant: number;
  readonly soldeApres: number;
  readonly positionId: string | null;
  readonly description: string;
}

export interface ResultatBougie {
  readonly etat: EtatMoteur;
  readonly evenements: readonly Evenement[];
  readonly ecritures: readonly Ecriture[];
}
