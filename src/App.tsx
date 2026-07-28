import { useState } from 'react';

import { BottomNav, type PageId } from '@/components/ui/BottomNav';
import { TopBar } from '@/components/ui/TopBar';
import { BacktestPage } from '@/pages/BacktestPage';
import { ChartPage } from '@/pages/ChartPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { StrategyPage } from '@/pages/StrategyPage';

/**
 * Coquille de l'application : en-tête permanent, page courante, onglets en bas.
 *
 * Pas de routeur pour l'instant. Cinq pages sans URL profonde ne justifient pas
 * une dépendance de plus, et Termux compile déjà assez lentement. On en ajoutera
 * un le jour où une URL devra être partageable.
 */
export default function App() {
  const [page, setPage] = useState<PageId>('dashboard');

  return (
    <div className="flex h-dvh flex-col bg-fond">
      <TopBar />

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {page === 'dashboard' ? <DashboardPage /> : null}
        {page === 'chart' ? <ChartPage /> : null}
        {page === 'strategy' ? <StrategyPage /> : null}
        {page === 'backtest' ? <BacktestPage /> : null}
        {page === 'settings' ? <SettingsPage /> : null}
      </main>

      <BottomNav page={page} onChange={setPage} />
    </div>
  );
}
