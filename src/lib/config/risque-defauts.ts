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
  /** Parmi les positions ouvertes, combien peuvent être fortement corrélées. */
  positionsCorreleesMax: 2,
  seuilCorrelation: 0.7,
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
