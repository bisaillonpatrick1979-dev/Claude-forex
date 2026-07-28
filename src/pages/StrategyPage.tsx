import { useCallback, useEffect, useState } from 'react';

import { ChartControls, DEFAULT_SYMBOLS } from '@/components/chart/ChartControls';
import { TradeList } from '@/components/strategy/TradeList';
import { EmptyState, Panel } from '@/components/ui/Panel';
import { AdapterError, loadSeries } from '@/data';
import { Engine, type EngineResult } from '@/engine/Engine';
import { EmaCrossAlpha, EMA_CROSS_DEFAULTS } from '@/engine/modules/EmaCrossAlpha';
import { useT } from '@/i18n';
import { usePortfolioStore } from '@/store/portfolioStore';
import { TIMEFRAME_SECONDS, type Timeframe } from '@/types/market';

/** Assez de bougies pour que deux moyennes se croisent plusieurs fois. */
const BOUGIES = 800;

/**
 * Écran Stratégie : le moteur tourne, ses trades s'affichent.
 *
 * Le passage se fait sur des bougies déjà closes, en argent fictif. Ce que
 * l'écran montre n'est pas une projection : c'est ce que la stratégie aurait
 * fait, frais et slippage déduits, sur les données réellement chargées.
 */
export function StrategyPage() {
  const t = useT();
  const config = usePortfolioStore((etat) => etat.config);

  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOLS[0]?.id ?? 'BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [reglages, setReglages] = useState(EMA_CROSS_DEFAULTS);
  const [resultat, setResultat] = useState<EngineResult | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  // Changer d'instrument invalide le passage précédent : laisser les trades
  // affichés donnerait à croire qu'ils portent sur le nouveau symbole.
  useEffect(() => {
    setResultat(null);
  }, [symbol, timeframe, reglages]);

  const lancer = useCallback(async () => {
    setEnCours(true);
    setErreur(null);
    try {
      const maintenant = Math.floor(Date.now() / 1000);
      const serie = await loadSeries({
        adapterId: 'binance',
        symbol,
        timeframe,
        from: maintenant - TIMEFRAME_SECONDS[timeframe] * BOUGIES,
        to: maintenant,
      });

      if (serie.bars.length === 0) {
        setErreur(t.strategy.needCandles);
        return;
      }

      const moteur = new Engine({
        symbol,
        timeframe,
        bars: serie.bars,
        config,
        alpha: new EmaCrossAlpha(reglages),
      });
      setResultat(moteur.run());
    } catch (cause: unknown) {
      setErreur(cause instanceof AdapterError ? cause.message : t.chart.failed);
    } finally {
      setEnCours(false);
    }
  }, [symbol, timeframe, config, reglages, t.strategy.needCandles, t.chart.failed]);

  return (
    <div className="flex flex-col gap-3">
      <Panel title={t.strategy.title}>
        <p className="mb-2 text-xs text-texte-doux">{t.strategy.engine}</p>
        <ChartControls
          symbol={symbol}
          timeframe={timeframe}
          onSymbol={setSymbol}
          onTimeframe={setTimeframe}
          onRefresh={() => void lancer()}
          busy={enCours}
        />

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Periode
            label={t.strategy.fast}
            value={reglages.fast}
            onChange={(fast) => setReglages((etat) => ({ ...etat, fast }))}
          />
          <Periode
            label={t.strategy.slow}
            value={reglages.slow}
            onChange={(slow) => setReglages((etat) => ({ ...etat, slow }))}
          />
          <Periode
            label={t.strategy.atr}
            value={reglages.atr}
            onChange={(atr) => setReglages((etat) => ({ ...etat, atr }))}
          />
        </div>

        <button
          type="button"
          onClick={() => void lancer()}
          disabled={enCours || reglages.fast >= reglages.slow}
          className="mt-3 min-h-tactile w-full rounded border border-accent text-sm text-accent disabled:opacity-40"
        >
          {enCours ? t.strategy.running : t.strategy.run}
        </button>

        {/* La règle de remplissage est dite à l'écran, pas seulement dans le
            code : c'est elle qui rend les chiffres ci-dessous crédibles. */}
        <p className="mt-2 text-[11px] leading-snug text-texte-doux/70">{t.strategy.fillNote}</p>
      </Panel>

      {erreur ? (
        <Panel>
          <EmptyState message={erreur} />
        </Panel>
      ) : null}

      {resultat ? <TradeList result={resultat} currency={config.currency} /> : null}
    </div>
  );
}

function Periode({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-texte-doux">{label}</span>
      <input
        type="number"
        min={1}
        max={400}
        value={value}
        onChange={(evenement) => {
          const saisi = Number(evenement.target.value);
          // Une saisie vide donne NaN : on garde la valeur précédente plutôt
          // que de casser le moteur le temps d'une frappe.
          if (Number.isFinite(saisi) && saisi >= 1) onChange(Math.round(saisi));
        }}
        className="chiffre min-h-tactile w-full rounded border border-bordure bg-fond px-2 text-sm"
      />
    </label>
  );
}
