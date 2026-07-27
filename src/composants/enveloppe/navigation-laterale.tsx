'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { NAVIGATION } from '@/lib/navigation';

/**
 * Navigation principale, repliable.
 *
 * La colonne mange une bande de onze rem qui ne sert qu'une fois par session :
 * on choisit une page, puis on veut la voir en entier. Repliée, elle ne garde
 * que des initiales et rend cette largeur à la salle des marchés.
 *
 * L'état vit dans `localStorage` — c'est une préférence d'affichage, pas une
 * donnée métier. Y stocker autre chose serait une faute ; y stocker cela évite
 * un aller-retour serveur pour un pli de barre latérale.
 *
 * Le premier rendu est toujours déplié : lire `localStorage` pendant le rendu
 * ferait diverger serveur et client, et React remplacerait tout le sous-arbre
 * en signalant une erreur d'hydratation. La lecture a lieu après le montage.
 */

const CLE_STOCKAGE = 'trading-floor:navigation-repliee';

/** Trois lettres suffisent à reconnaître une page déjà connue. */
function initiales(abrege: string): string {
  return abrege.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3);
}

export function NavigationLaterale() {
  const chemin = usePathname();
  const [repliee, setRepliee] = useState(false);

  useEffect(() => {
    try {
      setRepliee(window.localStorage.getItem(CLE_STOCKAGE) === '1');
    } catch {
      // Navigation privée ou stockage refusé : on reste déplié, sans bruit.
    }
  }, []);

  const basculer = () => {
    setRepliee((precedent) => {
      const suivant = !precedent;
      try {
        window.localStorage.setItem(CLE_STOCKAGE, suivant ? '1' : '0');
      } catch {
        // Le pli fonctionne quand même : il ne survivra simplement pas au
        // rechargement.
      }
      return suivant;
    });
  };

  return (
    <nav
      aria-label="Navigation principale"
      className={[
        'flex shrink-0 gap-1 overflow-x-auto border-b border-bordure bg-panneau px-2 py-1.5',
        'lg:flex-col lg:overflow-x-visible lg:border-b-0 lg:border-r lg:px-2 lg:py-3',
        repliee ? 'lg:w-14' : 'lg:w-44',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={basculer}
        aria-expanded={!repliee}
        title={repliee ? 'Déployer le menu' : 'Replier le menu'}
        className="hidden shrink-0 rounded px-2.5 py-1.5 text-left text-xs text-texte-attenue transition-colors hover:bg-panneau-clair/60 hover:text-texte lg:block"
      >
        {repliee ? '»' : '« Replier'}
      </button>

      {NAVIGATION.map((entree) => {
        const actif = chemin.startsWith(entree.href);
        return (
          <Link
            key={entree.href}
            href={entree.href}
            aria-current={actif ? 'page' : undefined}
            title={entree.libelle}
            className={[
              'shrink-0 rounded px-2.5 py-1.5 text-xs transition-colors lg:text-[0.82rem]',
              repliee ? 'lg:text-center' : '',
              actif
                ? 'bg-panneau-clair text-texte'
                : 'text-texte-attenue hover:bg-panneau-clair/60 hover:text-texte',
            ].join(' ')}
          >
            <span className="lg:hidden">{entree.abrege}</span>
            <span className="hidden lg:inline">
              {repliee ? initiales(entree.abrege) : entree.libelle}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
