import { RefreshCw } from 'lucide-react';

import { useT } from '@/i18n';
import { TIMEFRAMES, type Timeframe } from '@/types/market';

/** Instruments proposés d'emblée. Binance les sert tous sans clé. */
export const DEFAULT_SYMBOLS: readonly { id: string; label: string; decimals: number }[] = [
  { id: 'BTCUSDT', label: 'BTC / USDT', decimals: 2 },
  { id: 'ETHUSDT', label: 'ETH / USDT', decimals: 2 },
  { id: 'SOLUSDT', label: 'SOL / USDT', decimals: 3 },
  { id: 'BNBUSDT', label: 'BNB / USDT', decimals: 2 },
  { id: 'XRPUSDT', label: 'XRP / USDT', decimals: 5 },
];

/**
 * Sélecteurs d'instrument et d'unité de temps.
 *
 * Les unités sont des boutons et non un menu déroulant : c'est le réglage qu'on
 * change le plus souvent, et un menu impose deux gestes là où un bouton en
 * demande un seul.
 */
export function ChartControls({
  symbol,
  timeframe,
  onSymbol,
  onTimeframe,
  onRefresh,
  busy,
}: {
  symbol: string;
  timeframe: Timeframe;
  onSymbol: (symbol: string) => void;
  onTimeframe: (timeframe: Timeframe) => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  const t = useT();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          aria-label={t.chart.symbol}
          value={symbol}
          onChange={(evenement) => onSymbol(evenement.target.value)}
          className="chiffre min-h-tactile flex-1 rounded border border-bordure bg-fond px-2 text-sm"
        >
          {DEFAULT_SYMBOLS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t.chart.refresh}
          className="flex min-h-tactile min-w-tactile items-center justify-center rounded border border-bordure text-texte-doux disabled:opacity-40"
        >
          <RefreshCw size={16} className={busy ? 'animate-spin' : ''} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {TIMEFRAMES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onTimeframe(option)}
            className={[
              'chiffre min-h-tactile rounded border text-xs',
              option === timeframe
                ? 'border-accent text-accent'
                : 'border-bordure text-texte-doux',
            ].join(' ')}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
