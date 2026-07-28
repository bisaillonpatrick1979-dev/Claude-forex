import { useT } from '@/i18n';
import { LIMITS } from '@/lib/portfolioMath';
import { usePortfolioStore } from '@/store/portfolioStore';
import type { Currency } from '@/types/portfolio';

/**
 * Réglages du portefeuille.
 *
 * Curseur ET champ numérique côte à côte pour chaque pourcentage : le curseur
 * pour ajuster d'un pouce, le champ pour saisir une valeur précise sans viser
 * au pixel. Sur tablette, l'un sans l'autre est frustrant.
 *
 * Chaque écriture passe par `setConfig`, qui borne — l'interface n'a pas à
 * dupliquer les limites, elle les lit.
 */
function Ligne({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-bordure/60 py-2.5 last:border-0">
      <span className="text-xs text-texte-doux">{label}</span>
      {children}
    </div>
  );
}

function Curseur({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-tactile flex-1 accent-[#3B82F6]"
      />
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="chiffre min-h-tactile w-20 rounded border border-bordure bg-fond px-2 text-right text-sm"
        />
        <span className="w-4 text-xs text-texte-doux">{suffix}</span>
      </div>
    </div>
  );
}

export function AllocationSliders() {
  const t = useT();
  const config = usePortfolioStore((etat) => etat.config);
  const setConfig = usePortfolioStore((etat) => etat.setConfig);

  return (
    <div className="flex flex-col">
      <Ligne label={t.config.totalCapital}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            value={config.totalCapital}
            onChange={(e) => setConfig({ totalCapital: e.target.value })}
            className="chiffre min-h-tactile flex-1 rounded border border-bordure bg-fond px-2 text-right text-sm"
          />
          <select
            aria-label={t.config.currency}
            value={config.currency}
            onChange={(e) => setConfig({ currency: e.target.value as Currency })}
            className="chiffre min-h-tactile rounded border border-bordure bg-fond px-2 text-sm"
          >
            <option value="CAD">CAD</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </Ligne>

      <Ligne label={t.config.aiAllocationPct}>
        <Curseur
          value={config.aiAllocationPct}
          min={LIMITS.aiAllocationPct.min}
          max={LIMITS.aiAllocationPct.max}
          step={1}
          suffix="%"
          onChange={(aiAllocationPct) => setConfig({ aiAllocationPct })}
        />
      </Ligne>

      <Ligne label={t.config.maxTradeAmount}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={50}
          value={config.maxTradeAmount}
          onChange={(e) => setConfig({ maxTradeAmount: e.target.value })}
          className="chiffre min-h-tactile w-full rounded border border-bordure bg-fond px-2 text-right text-sm"
        />
      </Ligne>

      <Ligne label={t.config.maxTradePct}>
        <Curseur
          value={config.maxTradePct}
          min={LIMITS.maxTradePct.min}
          max={25}
          step={0.1}
          suffix="%"
          onChange={(maxTradePct) => setConfig({ maxTradePct })}
        />
      </Ligne>

      <Ligne label={t.config.maxOpenPositions}>
        <Curseur
          value={config.maxOpenPositions}
          min={LIMITS.maxOpenPositions.min}
          max={20}
          step={1}
          suffix=""
          onChange={(maxOpenPositions) => setConfig({ maxOpenPositions })}
        />
      </Ligne>

      <Ligne label={t.config.maxDailyLossPct}>
        <Curseur
          value={config.maxDailyLossPct}
          min={LIMITS.maxDailyLossPct.min}
          max={25}
          step={0.5}
          suffix="%"
          onChange={(maxDailyLossPct) => setConfig({ maxDailyLossPct })}
        />
      </Ligne>

      <Ligne label={t.config.maxDrawdownPct}>
        <Curseur
          value={config.maxDrawdownPct}
          min={LIMITS.maxDrawdownPct.min}
          max={50}
          step={1}
          suffix="%"
          onChange={(maxDrawdownPct) => setConfig({ maxDrawdownPct })}
        />
      </Ligne>

      <Ligne label={t.config.maxTradesPerHour}>
        <Curseur
          value={config.maxTradesPerHour}
          min={LIMITS.maxTradesPerHour.min}
          max={60}
          step={1}
          suffix=""
          onChange={(maxTradesPerHour) => setConfig({ maxTradesPerHour })}
        />
      </Ligne>

      <Ligne label={t.config.feeBps}>
        <Curseur
          value={config.feeBps}
          min={LIMITS.feeBps.min}
          max={100}
          step={1}
          suffix="bp"
          onChange={(feeBps) => setConfig({ feeBps })}
        />
      </Ligne>

      <Ligne label={t.config.slippageBps}>
        <Curseur
          value={config.slippageBps}
          min={LIMITS.slippageBps.min}
          max={100}
          step={1}
          suffix="bp"
          onChange={(slippageBps) => setConfig({ slippageBps })}
        />
      </Ligne>
    </div>
  );
}
