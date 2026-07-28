import { Panel } from '@/components/ui/Panel';
import type { EngineResult } from '@/engine/Engine';
import { useT } from '@/i18n';
import type { Currency } from '@/types/portfolio';
import type { ExitReason, Trade } from '@/types/trading';

/**
 * Résumé d'un passage du moteur et liste des trades.
 *
 * Le motif de sortie est affiché sur chaque ligne. Sans lui, une série de
 * pertes se lit comme de la malchance alors qu'elle peut être un stop mal
 * placé — et on ne corrige pas ce qu'on ne distingue pas.
 */
export function TradeList({ result, currency }: { result: EngineResult; currency: Currency }) {
  const t = useT();

  const gains = result.trades.filter((trade) => !trade.pnl.estNegatif()).length;

  return (
    <>
      <Panel title={t.strategy.title}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Cellule label={t.strategy.bars} value={String(result.barsProcessed)} />
          <Cellule label={t.strategy.signals} value={String(result.signals)} />
          <Cellule
            label={t.strategy.orders}
            value={`${result.trades.length}${result.trades.length > 0 ? ` · ${gains}↑` : ''}`}
          />
          <Cellule label={t.strategy.rejections} value={String(result.rejections)} />
          <Cellule
            label={t.strategy.equity}
            value={`${result.finalEquity.versTexte(2)} ${currency}`}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </Panel>

      <Panel title={t.strategy.tradesTitle}>
        {result.trades.length === 0 ? (
          <p className="py-6 text-center text-sm text-texte-doux">{t.strategy.noTrades}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {result.trades.map((trade) => (
              <LigneTrade key={trade.id} trade={trade} currency={currency} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function LigneTrade({ trade, currency }: { trade: Trade; currency: Currency }) {
  const t = useT();
  const perte = trade.pnl.estNegatif();

  return (
    <li className="rounded border border-bordure px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="chiffre text-xs uppercase tracking-wider text-texte-doux">
          {trade.side === 'buy' ? '▲' : '▼'} {trade.symbol}
        </span>
        <span className={`chiffre text-sm ${perte ? 'text-baisse' : 'text-hausse'}`}>
          {perte ? '' : '+'}
          {trade.pnl.versTexte(2)} {currency}
        </span>
      </div>

      <div className="chiffre mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-texte-doux/70">
        <span>
          {t.strategy.entry} {trade.entryPrice.versTexte(2)}
        </span>
        <span>
          {t.strategy.exit} {trade.exitPrice.versTexte(2)}
        </span>
        {/* Les frais sont montrés séparément : le net seul cacherait combien
            la stratégie a payé pour exister. */}
        <span>−{trade.fees.versTexte(2)}</span>
        <span className="uppercase">{motif(t, trade.exitReason)}</span>
      </div>
    </li>
  );
}

function motif(t: ReturnType<typeof useT>, reason: ExitReason): string {
  const table: Readonly<Record<ExitReason, string>> = {
    stop: t.strategy.exitStop,
    target: t.strategy.exitTarget,
    signal: t.strategy.exitSignal,
    manual: t.strategy.exitManual,
    panic: t.strategy.exitPanic,
    liquidation: t.strategy.exitLiquidation,
  };
  return table[reason];
}

function Cellule({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded border border-bordure px-3 py-2 ${className}`}>
      <p className="text-[11px] text-texte-doux">{label}</p>
      <p className="chiffre mt-0.5 text-sm">{value}</p>
    </div>
  );
}
