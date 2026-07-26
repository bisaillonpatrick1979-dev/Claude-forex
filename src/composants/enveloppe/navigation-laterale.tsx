'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAVIGATION } from '@/lib/navigation';

/**
 * Navigation principale. Colonne d'icônes textuelles sur grand écran, barre
 * horizontale défilante sur tablette et mobile — je travaille souvent sur
 * tablette, donc les deux dispositions sont de premier plan, pas un repli.
 */
export function NavigationLaterale() {
  const chemin = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-bordure bg-panneau px-2 py-1.5 lg:w-44 lg:flex-col lg:overflow-x-visible lg:border-b-0 lg:border-r lg:px-2 lg:py-3"
    >
      {NAVIGATION.map((entree) => {
        const actif = chemin.startsWith(entree.href);
        return (
          <Link
            key={entree.href}
            href={entree.href}
            aria-current={actif ? 'page' : undefined}
            className={[
              'shrink-0 rounded px-2.5 py-1.5 text-xs transition-colors lg:text-[13px]',
              actif
                ? 'bg-panneau-clair text-texte'
                : 'text-texte-attenue hover:bg-panneau-clair/60 hover:text-texte',
            ].join(' ')}
          >
            <span className="lg:hidden">{entree.abrege}</span>
            <span className="hidden lg:inline">{entree.libelle}</span>
          </Link>
        );
      })}
    </nav>
  );
}
