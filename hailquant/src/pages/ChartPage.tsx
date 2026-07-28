import { EmptyState, Panel } from '@/components/ui/Panel';
import { useT } from '@/i18n';

export function ChartPage() {
  const t = useT();
  return (
    <Panel title={t.chart.title}>
      <EmptyState message={t.chart.loading} hint={t.common.phaseComing} />
    </Panel>
  );
}
