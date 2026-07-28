import { BarChart3, FlaskConical, LayoutDashboard, LineChart, Settings } from 'lucide-react';

import { useT } from '@/i18n';

export type PageId = 'dashboard' | 'chart' | 'strategy' | 'backtest' | 'settings';

/**
 * Navigation par onglets en bas d'écran.
 *
 * En bas et non en haut : sur une tablette tenue à deux mains, le haut de
 * l'écran est hors de portée du pouce. C'est aussi pour ça que chaque cible
 * fait au moins 44 px de haut — en dessous, on rate l'onglet voisin une fois
 * sur cinq.
 *
 * Aucun état ne dépend du survol : sur tactile, `hover` n'existe pas, et une
 * fonction qui n'apparaît qu'au survol est une fonction inaccessible.
 */
export function BottomNav({
  page,
  onChange,
}: {
  page: PageId;
  onChange: (page: PageId) => void;
}) {
  const t = useT();

  const onglets: readonly { id: PageId; label: string; Icone: typeof LayoutDashboard }[] = [
    { id: 'dashboard', label: t.nav.dashboard, Icone: LayoutDashboard },
    { id: 'chart', label: t.nav.chart, Icone: LineChart },
    { id: 'strategy', label: t.nav.strategy, Icone: FlaskConical },
    { id: 'backtest', label: t.nav.backtest, Icone: BarChart3 },
    { id: 'settings', label: t.nav.settings, Icone: Settings },
  ];

  return (
    <nav
      aria-label={t.app.name}
      className="safe-bas sticky bottom-0 z-20 grid shrink-0 grid-cols-5 border-t border-bordure bg-surface"
    >
      {onglets.map(({ id, label, Icone }) => {
        const actif = page === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={actif ? 'page' : undefined}
            className={[
              'flex min-h-tactile flex-col items-center justify-center gap-1 px-1 py-2',
              'transition-colors',
              actif ? 'text-accent' : 'text-texte-doux active:text-texte',
            ].join(' ')}
          >
            <Icone size={20} strokeWidth={actif ? 2.4 : 1.8} aria-hidden />
            {/* Le libellé reste visible : une barre d'icônes seules oblige à
                deviner, et on devine mal dans une application dense. */}
            <span className="text-[11px] leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
