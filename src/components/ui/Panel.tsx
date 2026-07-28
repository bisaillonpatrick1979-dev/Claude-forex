import type { ReactNode } from 'react';

/** Bloc de base : bordé, titré, dense mais respirant sous le pouce. */
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-bordure bg-surface ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-bordure px-3 py-2.5">
          <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-texte-doux">
            {title}
          </h2>
          {action}
        </header>
      ) : null}
      <div className="p-3">{children}</div>
    </section>
  );
}

/**
 * Un panneau sans données dit ce qu'il attend. On ne remplit jamais un vide
 * avec des valeurs d'exemple : une donnée absente doit se voir comme absente.
 */
export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <p className="text-sm text-texte-doux">{message}</p>
      {hint ? <p className="chiffre text-xs text-texte-doux/60">{hint}</p> : null}
    </div>
  );
}
