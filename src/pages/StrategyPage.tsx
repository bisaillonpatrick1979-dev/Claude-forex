import { EmptyState, Panel } from '@/components/ui/Panel';
import { useT } from '@/i18n';

export function StrategyPage() {
  const t = useT();
  return (
    <Panel title={t.strategy.title}>
      <EmptyState message={t.strategy.noStrategy} hint={t.common.phaseComing} />
    </Panel>
  );
}
