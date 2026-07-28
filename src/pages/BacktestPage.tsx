import { EmptyState, Panel } from '@/components/ui/Panel';
import { useT } from '@/i18n';

export function BacktestPage() {
  const t = useT();
  return (
    <Panel title={t.backtest.title}>
      <EmptyState message={t.backtest.noRun} hint={t.common.phaseComing} />
    </Panel>
  );
}
