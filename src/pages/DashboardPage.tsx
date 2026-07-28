import { EmptyState, Panel } from '@/components/ui/Panel';
import { useT } from '@/i18n';

export function DashboardPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Panel title={t.dashboard.title}>
        <EmptyState message={t.dashboard.noData} hint={t.common.phaseComing} />
      </Panel>
    </div>
  );
}
