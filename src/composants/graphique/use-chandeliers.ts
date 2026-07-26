'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Chandelier, Intervalle, OrigineDonnees } from '@/lib/marche/types';

/**
 * Récupération et rafraîchissement des chandeliers.
 *
 * Seul identifiant du projet nommé en anglais : React impose le préfixe `use`
 * pour reconnaître un hook, et son linter refuse tout autre nom. La convention
 * du framework l'emporte sur celle du projet.
 *
 * Le sondage remplace un WebSocket : la fréquence est calée sur le TTL du
 * cache côté serveur, donc un sondage plus rapide ne rapporterait rien de
 * nouveau — il consommerait du quota fournisseur pour rien.
 *
 * L'état précédent est **conservé pendant le rechargement**. C'est ce qui évite
 * le clignotement : le graphique n'est jamais vidé puis rempli, il reçoit des
 * mises à jour incrémentales.
 */

const PERIODES_SONDAGE_MS: Readonly<Record<Intervalle, number>> = {
  M1: 20_000,
  M5: 30_000,
  M15: 60_000,
  M30: 60_000,
  H1: 120_000,
  H4: 300_000,
  D1: 600_000,
  W1: 600_000,
};

export interface EtatChandeliers {
  readonly chandeliers: readonly Chandelier[];
  readonly origine: OrigineDonnees | null;
  readonly fournisseur: string | null;
  readonly perime: boolean;
  readonly retarde: boolean;
  readonly incidents: readonly { fournisseur: string; raison: string }[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly recupereLe: number | null;
}

interface ReponseApi {
  chandeliers?: Chandelier[];
  origine?: OrigineDonnees;
  fournisseur?: string;
  perime?: boolean;
  retarde?: boolean;
  incidents?: { fournisseur: string; raison: string }[];
  recupereLe?: number;
  erreur?: string;
}

const ETAT_INITIAL: EtatChandeliers = {
  chandeliers: [],
  origine: null,
  fournisseur: null,
  perime: false,
  retarde: false,
  incidents: [],
  chargement: true,
  erreur: null,
  recupereLe: null,
};

export function useChandeliers(
  symbole: string,
  intervalle: Intervalle,
  limite = 400,
): EtatChandeliers & { rafraichir: () => void } {
  const [etat, setEtat] = useState<EtatChandeliers>(ETAT_INITIAL);
  const cleRef = useRef(`${symbole}|${intervalle}`);

  const charger = useCallback(
    async (forcer: boolean, signal: AbortSignal) => {
      const cle = `${symbole}|${intervalle}`;
      const changementInstrument = cle !== cleRef.current;

      setEtat((precedent) => ({
        // Changer d'instrument doit vider la série : garder les bougies du
        // symbole précédent afficherait des prix qui n'existent pas ici.
        ...(changementInstrument ? ETAT_INITIAL : precedent),
        chargement: true,
      }));

      try {
        const url = new URL('/api/marche/chandeliers', window.location.origin);
        url.searchParams.set('symbole', symbole);
        url.searchParams.set('intervalle', intervalle);
        url.searchParams.set('limite', String(limite));
        if (forcer) url.searchParams.set('rafraichir', '1');

        const reponse = await fetch(url, { cache: 'no-store', signal });
        const corps = (await reponse.json()) as ReponseApi;

        if (signal.aborted) return;
        cleRef.current = cle;

        if (!reponse.ok || corps.erreur) {
          setEtat((precedent) => ({
            ...precedent,
            chargement: false,
            erreur: corps.erreur ?? `Échec de la récupération (${reponse.status}).`,
            incidents: corps.incidents ?? [],
          }));
          return;
        }

        setEtat({
          chandeliers: corps.chandeliers ?? [],
          origine: corps.origine ?? null,
          fournisseur: corps.fournisseur ?? null,
          perime: corps.perime ?? false,
          retarde: corps.retarde ?? false,
          incidents: corps.incidents ?? [],
          chargement: false,
          erreur: null,
          recupereLe: corps.recupereLe ?? null,
        });
      } catch (erreur) {
        if (signal.aborted) return;
        setEtat((precedent) => ({
          ...precedent,
          chargement: false,
          erreur: erreur instanceof Error ? erreur.message : 'Appel impossible.',
        }));
      }
    },
    [symbole, intervalle, limite],
  );

  useEffect(() => {
    const controleur = new AbortController();
    void charger(false, controleur.signal);

    const minuterie = setInterval(() => {
      // Onglet en arrière-plan : inutile de consommer du quota pour un
      // graphique que personne ne regarde.
      if (document.visibilityState !== 'visible') return;
      void charger(false, controleur.signal);
    }, PERIODES_SONDAGE_MS[intervalle]);

    return () => {
      controleur.abort();
      clearInterval(minuterie);
    };
  }, [charger, intervalle]);

  const rafraichir = useCallback(() => {
    const controleur = new AbortController();
    void charger(true, controleur.signal);
  }, [charger]);

  return { ...etat, rafraichir };
}
