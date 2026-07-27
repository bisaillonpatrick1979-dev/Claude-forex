import type { ReactNode } from 'react';

/** Bloc de base de l'interface : un panneau bordé, titré, dense. */
export function Panneau({
  titre,
  action,
  children,
  className = '',
  defilement = false,
}: {
  titre?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Défilement interne. Désactivé par défaut, et jamais sous `xl` même quand
   * il est demandé.
   *
   * Un panneau qui défile à l'intérieur de lui-même sur une tablette produit
   * une boîte de trois lignes dans laquelle il faut chercher : on préfère
   * laisser le panneau grandir et faire défiler la page entière. Le défilement
   * interne n'a de sens que sur un grand écran, là où la salle des marchés
   * tient en une hauteur d'écran sans que rien ne soit tassé.
   */
  defilement?: boolean;
}) {
  return (
    <section
      className={`flex flex-col rounded-lg border border-bordure bg-panneau xl:min-h-0 ${className}`}
    >
      {titre ? (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-bordure px-3 py-2.5">
          <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-texte-attenue">
            {titre}
          </h2>
          {action}
        </header>
      ) : null}
      <div
        className={`flex-1 p-3 ${defilement ? 'xl:min-h-0 xl:overflow-auto' : ''}`}
      >
        {children}
      </div>
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
