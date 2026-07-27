/**
 * Valeurs par défaut des garde-fous de risque.
 *
 * Ces nombres sont dupliqués dans la migration SQL (table parametres_risque)
 * parce qu'un profil doit être valide dès sa création, avant tout code
 * applicatif. La source de vérité à l'exécution reste la ligne en base : le
 * moteur de risque (phase 3) lit la base, jamais cette constante.
 */
export const RISQUE_DEFAUTS = {
  /** Part du capital risquée par trade, calculée depuis la distance au stop. */
  risqueMaxParTradePct: 1,
  /** Somme des risques ouverts simultanément. */
  risqueTotalMaxPct: 5,
  positionsMax: 5,
  /**
   * Part du risque agrégé qu'une seule position peut porter.
   *
   * 50 % est le réglage neutre : deux positions de même taille et de même
   * corrélation en portent exactement la moitié chacune, donc ce plafond
   * n'entrave jamais un portefeuille équilibré. Il refuse en revanche qu'une
   * ligne devienne le portefeuille à elle seule.
   */
  partPositionMaxPct: 50,
  /**
   * Exposition nette maximale d'un facteur — devise ou classe d'actif — en
   * pourcentage du budget de risque total.
   *
   * C'est la contrainte qui remplace le compteur de positions corrélées. Avec
   * un budget de 5 % et ce plafond, aucune devise ne peut porter plus de 2,5 %
   * du capital en net : long EUR/USD, long GBP/USD et short USD/CHF ne peuvent
   * plus s'empiler comme trois paris distincts alors qu'ils n'en font qu'un.
   */
  partFacteurMaxPct: 50,
  /** Atteinte : arrêt des agents jusqu'au lendemain. */
  perteJournaliereMaxPct: 3,
  /** Atteinte : arrêt complet, reprise sur intervention manuelle. */
  drawdownMaxPct: 15,
  /** Plafond maison, indépendant de ce que le broker autoriserait. */
  levierMax: 10,
  /** Fenêtre d'interdiction autour d'un événement macro à fort impact. */
  fenetreEvenementMacroMinutes: 30,
  /** Un ordre sans stop-loss est rejeté, sans exception. */
  stopLossObligatoire: true,
} as const;

export type RisqueDefauts = typeof RISQUE_DEFAUTS;
