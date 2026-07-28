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
    equityCurve: 'Equity curve',
    noCurve: 'No equity recorded yet. The curve fills as the engine runs.',
    positions: 'Positions',
    noPositions: 'No open position.',
    aiArmed: 'AI armed',
    aiDisarmed: 'AI disarmed',
    armAi: 'Arm the AI',
    disarmAi: 'Disarm the AI',
    armBlocked: 'Trading is halted — clear it before arming the AI.',
  },
  config: {
    title: 'Portfolio',
    totalCapital: 'Total capital',
    aiAllocationPct: 'Share entrusted to the AI',
    maxTradeAmount: 'Max per trade (amount)',
    maxTradePct: 'Max per trade (% of AI capital)',
    maxOpenPositions: 'Max open positions',
    maxDailyLossPct: 'Daily loss limit',
    maxDrawdownPct: 'Max drawdown',
    maxTradesPerHour: 'Max trades per hour',
    feeBps: 'Fees (bps)',
    slippageBps: 'Slippage (bps)',
    currency: 'Currency',
    derived: 'What this actually allows',
    aiCapital: 'AI capital',
    effectiveMaxTrade: 'Effective cap per trade',
    dailyLossLimit: 'Daily loss limit',
    drawdownLimit: 'Drawdown limit',
    roundTripCost: 'Round-trip cost at cap',
    resetConfirm: 'Reset the portfolio? Positions and equity curve are cleared. Settings are kept.',
  },
  warn: {
    'no-ai-capital': 'No capital entrusted to the AI: it can analyse, but it cannot open anything.',
    'absolute-cap-binds': 'The amount cap binds first — raising the percentage changes nothing.',
    'pct-cap-binds': 'The percentage cap binds first — raising the amount changes nothing.',
    'cost-heavy': 'Fees and slippage exceed 1 % of a trade. It takes a large edge just to break even.',
    'daily-below-trade': 'The daily loss limit is smaller than one trade: a single loser halts the day.',
    'zero-costs': 'Fees and slippage are both zero. A backtest without costs is a lie.',
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
  strategy: {
    title: 'Strategy',
    noStrategy: 'No strategy configured yet.',
    engine: 'EMA crossover — simulated',
    run: 'Run on loaded candles',
    running: 'Running…',
    fast: 'Fast EMA',
    slow: 'Slow EMA',
    atr: 'ATR period',
    bars: 'Candles',
    signals: 'Signals',
    orders: 'Trades',
    rejections: 'Blocked by risk',
    equity: 'Envelope after run',
    noTrades: 'No trade on this series with these settings.',
    tradesTitle: 'Simulated trades',
    entry: 'Entry',
    exit: 'Exit',
    pnl: 'P&L',
    why: 'Why',
    exitStop: 'stop',
    exitTarget: 'target',
    exitSignal: 'signal',
    exitManual: 'manual',
    exitPanic: 'panic',
    exitLiquidation: 'liquidation',
    needCandles: 'Load candles on the Chart tab first.',
    fillNote:
      'Orders decided at a close fill at the NEXT candle open, with fees and slippage. Never at the close that produced the decision.',
  },
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
