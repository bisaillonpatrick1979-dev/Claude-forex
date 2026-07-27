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
    // `corps-panneau` ne fait rien hors du mode cockpit : le panneau prend
    // alors la hauteur de son contenu, et c'est la page qui défile. En cockpit,
    // la règle CSS lui rend un défilement interne pour qu'un contenu trop long
    // ne recouvre jamais le panneau suivant.
    <section
      className={`cockpit-flexible flex flex-col rounded-lg border border-bordure bg-panneau ${className}`}
    >
      {titre ? (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-bordure px-3 py-2.5">
          <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-texte-attenue">
            {titre}
          </h2>
          {action}
        </header>
      ) : null}
      <div className="corps-panneau flex-1 p-3">{children}</div>
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
      {phase ? <p className="chiffre text-xs text-texte-attenue/60">{phase}</p> : null}
    </div>
  );
}
