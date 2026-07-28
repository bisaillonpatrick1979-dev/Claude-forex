import { useT } from '@/i18n';
import { EmptyState } from '@/components/ui/Panel';
import type { EquityPoint } from '@/store/portfolioStore';

/**
 * Courbe d'équité, en SVG.
 *
 * Pas de bibliothèque de graphiques ici : une polyligne suffit, et créer une
 * seconde instance de lightweight-charts pour tracer une ligne coûterait de la
 * mémoire et un cycle de vie de plus à gérer sur mobile.
 *
 * L'échelle verticale part du minimum réel et non de zéro. Une courbe qui
 * démarre à zéro écrase toutes les variations en une ligne plate — on ne verrait
 * plus rien de ce qui se passe.
 */
export function EquityCurve({ points, height = 120 }: { points: readonly EquityPoint[]; height?: number }) {
  const t = useT();

  if (points.length < 2) {
    return <EmptyState message={t.dashboard.noCurve} />;
  }

  const valeurs = points.map((p) => Number(p.equity)).filter(Number.isFinite);
  if (valeurs.length < 2) return <EmptyState message={t.dashboard.noCurve} />;

  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  // Amplitude nulle : une courbe parfaitement plate est réelle, il faut juste
  // éviter la division par zéro qui la ferait disparaître.
  const amplitude = max - min || 1;

  const largeur = 300;
  const marge = 4;
  const utile = height - marge * 2;

  const chemin = valeurs
    .map((valeur, index) => {
      const x = (index / (valeurs.length - 1)) * largeur;
      const y = marge + utile - ((valeur - min) / amplitude) * utile;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const premier = valeurs[0] ?? 0;
  const dernier = valeurs[valeurs.length - 1] ?? 0;
  const couleur = dernier >= premier ? '#26A69A' : '#EF5350';

  return (
    <svg
      viewBox={`0 0 ${largeur} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={t.dashboard.equityCurve}
    >
      <path d={chemin} fill="none" stroke={couleur} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
