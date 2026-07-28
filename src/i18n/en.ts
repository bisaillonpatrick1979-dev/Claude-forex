/**
 * English is the default language. Every user-facing string lives here — a
 * component that hardcodes text cannot be translated, and the miss is only
 * discovered by someone reading the wrong language on their screen.
 */
export const en = {
  app: {
    name: 'HailQuant',
    /** Permanent, on every screen. Never softened, never hidden. */
    simulationBanner: 'Simulation — fictional money',
    tagline: 'Algorithmic trading laboratory',
  },
  nav: {
    dashboard: 'Dashboard',
    chart: 'Chart',
    strategy: 'Strategy',
    backtest: 'Backtest',
    settings: 'Settings',
  },
  dashboard: {
    title: 'Dashboard',
    equity: 'Equity',
    cash: 'Cash (realised)',
    openPositions: 'Open positions',
    drawdown: 'Drawdown',
    aiAllocation: 'Capital entrusted to the AI',
    noData: 'Nothing to show yet.',
  },
  chart: {
    title: 'Chart',
    symbol: 'Symbol',
    timeframe: 'Timeframe',
    source: 'Source',
    attribution: 'Charts by TradingView',
    loading: 'Loading candles…',
    empty: 'No candles for this range.',
    refresh: 'Refresh',
    bars: 'candles',
    sourceNetwork: 'live',
    sourceCache: 'cache',
    sourceStale: 'cache — stale',
    sourceFile: 'file',
    failed: 'Could not load candles.',
  },
  strategy: { title: 'Strategy', noStrategy: 'No strategy configured yet.' },
  backtest: { title: 'Backtest', run: 'Run backtest', noRun: 'No backtest run yet.' },
  settings: {
    title: 'Settings',
    language: 'Language',
    currency: 'Currency',
    theme: 'Appearance',
  },
  risk: {
    panic: 'PANIC',
    panicHint: 'Closes every position at market and disarms the AI.',
    killSwitchArmed: 'Trading halted',
    aiArmed: 'AI armed',
    aiDisarmed: 'AI disarmed',
  },
  common: {
    phaseComing: 'Arriving in a later phase.',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    reset: 'Reset',
    missing: 'missing data',
  },
} as const;

/**
 * Élargit les chaînes littérales en `string`, sans toucher à la structure.
 *
 * Sans cela, le `as const` ci-dessus imposerait au français d'employer les
 * mots anglais : « Tableau de bord » n'est pas assignable au type littéral
 * « Dashboard ». On veut l'inverse exact — mêmes clés obligatoires, valeurs
 * libres. Une clé oubliée casse toujours la compilation ; une traduction
 * différente, non.
 */
type Elargir<T> = {
  [K in keyof T]: T[K] extends string ? string : Elargir<T[K]>;
};

export type Dictionary = Elargir<typeof en>;
