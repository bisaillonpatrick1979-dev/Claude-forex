import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { en, type Dictionary } from './en';
import { fr } from './fr';

export type Lang = 'en' | 'fr';

const DICTIONNAIRES: Readonly<Record<Lang, Dictionary>> = { en, fr };

interface EtatLangue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

/**
 * La langue est persistée : la rechoisir à chaque ouverture serait une
 * friction quotidienne. L'anglais reste le défaut, conformément à la
 * spécification.
 */
export const useLangStore = create<EtatLangue>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'hailquant:lang' },
  ),
);

/**
 * Accès au dictionnaire courant.
 *
 * Rend l'objet plutôt qu'une fonction `t('a.b.c')` sur clé textuelle : le
 * chemin est alors vérifié par TypeScript, et une clé supprimée casse la
 * compilation au lieu d'afficher une chaîne vide en production.
 */
export function useT(): Dictionary {
  const lang = useLangStore((etat) => etat.lang);
  return DICTIONNAIRES[lang];
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useLangStore((etat) => etat.lang);
  const setLang = useLangStore((etat) => etat.setLang);
  return [lang, setLang];
}
