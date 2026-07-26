import type { ReactNode } from 'react';

/** Bloc de base de l'interface : un panneau bordé, titré, dense. */
export function Panneau({
  titre,
  action,
  children,
  className = '',
}: {
  titre?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-lg border border-bordure bg-panneau ${className}`}
    >
      {titre ? (
        <header className="flex shrink-0 items-center justify-between border-b border-bordure px-3 py-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-texte-attenue">
            {titre}
          </h2>
          {action}
        </header>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </section>
  );
}

/**
 * Un panneau sans données affiche ce qu'il attend et à quelle phase il arrive.
 * On ne remplit jamais un vide avec des valeurs d'exemple : une donnée
 * manquante doit se voir comme manquante.
 */
export function EtatVide({ message, phase }: { message: string; phase?: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
      <p className="text-sm text-texte-attenue">{message}</p>
      {phase ? <p className="chiffre text-[11px] text-texte-attenue/60">{phase}</p> : null}
    </div>
  );
}
