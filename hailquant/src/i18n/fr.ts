import type { Dictionary } from './en';

/**
 * Le type `Dictionary` force la parité : ajouter une clé en anglais sans la
 * traduire ici casse la compilation. C'est voulu — une clé manquante afficherait
 * un identifiant technique à l'écran, et personne ne s'en apercevrait avant un
 * utilisateur.
 */
export const fr: Dictionary = {
  app: {
    name: 'HailQuant',
    simulationBanner: 'Simulation — argent fictif',
    tagline: 'Laboratoire de trading algorithmique',
  },
  nav: {
    dashboard: 'Tableau de bord',
    chart: 'Graphique',
    strategy: 'Stratégie',
    backtest: 'Backtest',
    settings: 'Réglages',
  },
  dashboard: {
    title: 'Tableau de bord',
    equity: 'Équité',
    cash: 'Solde (réalisé)',
    openPositions: 'Positions ouvertes',
    drawdown: 'Repli maximal',
    aiAllocation: 'Capital confié à l’IA',
    noData: 'Rien à afficher pour l’instant.',
  },
  chart: {
    title: 'Graphique',
    symbol: 'Instrument',
    timeframe: 'Unité de temps',
    attribution: 'Graphiques par TradingView',
    loading: 'Chargement des bougies…',
  },
  strategy: { title: 'Stratégie', noStrategy: 'Aucune stratégie configurée.' },
  backtest: { title: 'Backtest', run: 'Lancer le backtest', noRun: 'Aucun backtest lancé.' },
  settings: {
    title: 'Réglages',
    language: 'Langue',
    currency: 'Devise',
    theme: 'Apparence',
  },
  risk: {
    panic: 'PANIC',
    panicHint: 'Ferme toutes les positions au marché et désarme l’IA.',
    killSwitchArmed: 'Trading arrêté',
    aiArmed: 'IA armée',
    aiDisarmed: 'IA désarmée',
  },
  common: {
    phaseComing: 'Arrive dans une phase ultérieure.',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    save: 'Enregistrer',
    reset: 'Réinitialiser',
    missing: 'donnée manquante',
  },
};
