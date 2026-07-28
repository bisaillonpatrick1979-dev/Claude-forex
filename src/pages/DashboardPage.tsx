import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { EquityCurve } from '@/components/portfolio/EquityCurve';
import { EmptyState, Panel } from '@/components/ui/Panel';
import { useLangStore, useT } from '@/i18n';
import { formatMoney, formatPercent, pnlClass } from '@/lib/format';
import { deriveLimits, drawdownPct } from '@/lib/portfolioMath';
import { d } from '@/lib/decimal';
import { usePortfolioStore } from '@/store/portfolioStore';

/**
 * Tableau de bord : ce que vaut le portefeuille, et qui a la main.
 *
 * Les chiffres affichés sont ceux du store, jamais des exemples. Tant que le
 * moteur n'a pas tourné, l'équité vaut le capital et la courbe est vide — c'est
 * l'état réel, et le dire vaut mieux que de remplir l'écran.
 */
export function DashboardPage() {
  const t = useT();
  const lang = useLangStore((etat) => etat.lang);

  const config = usePortfolioStore((etat) => etat.config);
  const snapshot = usePortfolioStore((etat) => etat.snapshot);
  const courbe = usePortfolioStore((etat) => etat.equityCurve);
  const aiArmed = usePortfolioStore((etat) => etat.aiArmed);
  const killSwitchArmed = usePortfolioStore((etat) => etat.killSwitchArmed);
  const haltReason = usePortfolioStore((etat) => etat.haltReason);
  const armAi = usePortfolioStore((etat) => etat.armAi);
  const reset = usePortfolioStore((etat) => etat.reset);

  const [confirmation, setConfirmation] = useState(false);

  const limites = deriveLimits(config);
  const equite = d(snapshot.equity);
  const sommet = d(snapshot.peakEquity);
  const repli = drawdownPct(equite, sommet);
  const pnl = equite.moins(d(config.totalCapital)).versNombre();

  return (
    <div className="flex flex-col gap-3">
      {killSwitchArmed ? (
        <p className="rounded border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t.risk.killSwitchArmed}
          {haltReason ? ` — ${haltReason}` : ''}
        </p>
      ) : null}

      <Panel
        title={t.dashboard.title}
        action={
          <button
            type="button"
            onClick={() => setConfirmation(true)}
            aria-label={t.common.reset}
            className="flex min-h-tactile min-w-tactile items-center justify-center text-texte-doux active:text-texte"
          >
            <RotateCcw size={16} aria-hidden />
          </button>
        }
      >
        <dl className="grid grid-cols-2 gap-2">
          <Cellule label={t.dashboard.equity} value={formatMoney(equite.versNombre(), config.currency, lang)} tone={pnlClass(pnl)} />
          <Cellule label={t.dashboard.cash} value={formatMoney(d(snapshot.cash).versNombre(), config.currency, lang)} />
          <Cellule
            label={t.dashboard.aiAllocation}
            value={formatMoney(limites.aiCapital.versNombre(), config.currency, lang)}
            tone="text-accent"
          />
          <Cellule label={t.dashboard.drawdown} value={formatPercent(repli, lang)} />
          <Cellule label={t.dashboard.openPositions} value={String(snapshot.openPositions)} />
          <Cellule
            label={t.config.effectiveMaxTrade}
            value={formatMoney(limites.maxTradeValue.versNombre(), config.currency, lang)}
          />
        </dl>

        {confirmation ? (
          <div className="mt-3 rounded border border-danger/40 bg-danger/5 p-2.5">
            <p className="text-xs text-texte-doux">{t.config.resetConfirm}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  reset();
                  setConfirmation(false);
                }}
                className="min-h-tactile flex-1 rounded bg-danger px-3 text-xs font-semibold text-white"
              >
                {t.common.confirm}
              </button>
              <button
                type="button"
                onClick={() => setConfirmation(false)}
                className="min-h-tactile flex-1 rounded border border-bordure px-3 text-xs text-texte-doux"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel title={t.dashboard.equityCurve}>
        <EquityCurve points={courbe} />
      </Panel>

      <Panel title={t.dashboard.positions}>
        <EmptyState message={t.dashboard.noPositions} hint={t.common.phaseComing} />
      </Panel>

      <button
        type="button"
        onClick={() => armAi(!aiArmed)}
        disabled={killSwitchArmed}
        className={[
          'min-h-tactile rounded px-4 text-sm font-medium transition-colors',
          killSwitchArmed
            ? 'border border-bordure text-texte-doux opacity-50'
            : aiArmed
              ? 'border border-alerte/50 bg-alerte/10 text-alerte'
              : 'bg-accent text-fond',
        ].join(' ')}
      >
        {killSwitchArmed ? t.dashboard.armBlocked : aiArmed ? t.dashboard.disarmAi : t.dashboard.armAi}
      </button>
    </div>
  );
}

function Cellule({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-bordure bg-fond px-2.5 py-2">
      <dt className="text-[11px] leading-tight text-texte-doux">{label}</dt>
      <dd className={`chiffre mt-1 text-sm ${tone}`}>{value}</dd>
    </div>
  );
}
