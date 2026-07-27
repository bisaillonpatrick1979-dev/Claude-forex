'use client';

import { useState } from 'react';

import { Panneau } from '@/composants/ui/panneau';

/**
 * Sonde de vérification.
 *
 * Le graphique n'arrive qu'en phase 2 : sans cet écran, il n'y aurait aucun
 * moyen de constater que la couche de données fonctionne, ni de voir la
 * cascade de repli s'exercer. Elle affiche brut ce que le routeur a décidé —
 * fournisseur retenu, origine, fraîcheur et chaque tentative échouée.
 */

interface Chandelier {
  horodatage: number;
  ouverture: number;
  haut: number;
  bas: number;
  cloture: number;
  volume: number | null;
}

interface ReponseSonde {
  chandeliers?: Chandelier[];
  origine?: string;
  fournisseur?: string;
  perime?: boolean;
  retarde?: boolean;
  incidents?: { fournisseur: string; raison: string }[];
  recupereLe?: number;
  erreur?: string;
}

const INTERVALLES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'] as const;

export function SondeMarche({ symboles }: { symboles: readonly { code: string; libelle: string }[] }) {
  const [symbole, setSymbole] = useState(symboles[0]?.code ?? 'EURUSD');
  const [intervalle, setIntervalle] = useState<string>('M5');
  const [reponse, setReponse] = useState<ReponseSonde | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function sonder(rafraichir: boolean) {
    setEnCours(true);
    setReponse(null);
    try {
      const url = new URL('/api/marche/chandeliers', window.location.origin);
      url.searchParams.set('symbole', symbole);
      url.searchParams.set('intervalle', intervalle);
      url.searchParams.set('limite', '5');
      if (rafraichir) url.searchParams.set('rafraichir', '1');

      const resultat = await fetch(url, { cache: 'no-store' });
      setReponse((await resultat.json()) as ReponseSonde);
    } catch (erreur) {
      setReponse({ erreur: erreur instanceof Error ? erreur.message : 'Appel impossible.' });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Panneau titre="Sonde — vérifier la chaîne de données">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={symbole}
          onChange={(evenement) => setSymbole(evenement.target.value)}
          className="chiffre rounded border border-bordure bg-fond px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          {symboles.map((entree) => (
            <option key={entree.code} value={entree.code}>
              {entree.code} — {entree.libelle}
            </option>
          ))}
        </select>

        <select
          value={intervalle}
          onChange={(evenement) => setIntervalle(evenement.target.value)}
          className="chiffre rounded border border-bordure bg-fond px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          {INTERVALLES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={enCours}
          onClick={() => sonder(false)}
          className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-fond disabled:opacity-40"
        >
          {enCours ? 'Appel…' : 'Récupérer'}
        </button>
        <button
          type="button"
          disabled={enCours}
          onClick={() => sonder(true)}
          title="Ignore le cache et force un appel fournisseur"
          className="rounded border border-bordure px-2.5 py-1.5 text-xs text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
        >
          Forcer l’appel
        </button>
      </div>

      {reponse ? (
        <div className="mt-3 text-xs">
          {reponse.erreur ? (
            <p className="rounded border border-baisse/40 bg-baisse/10 px-2.5 py-2 text-baisse">
              {reponse.erreur}
            </p>
          ) : (
            <p className="chiffre text-texte-attenue">
              {reponse.fournisseur} · {reponse.origine}
              {reponse.perime ? ' · DONNÉES PÉRIMÉES' : ''}
              {reponse.retarde ? ' · retardées' : ''}
            </p>
          )}

          {reponse.chandeliers && reponse.chandeliers.length > 0 ? (
            <table className="mt-2 w-full text-left">
              <thead className="text-texte-attenue">
                <tr>
                  <th className="pb-1 font-medium">Horodatage UTC</th>
                  <th className="pb-1 text-right font-medium">O</th>
                  <th className="pb-1 text-right font-medium">H</th>
                  <th className="pb-1 text-right font-medium">B</th>
                  <th className="pb-1 text-right font-medium">C</th>
                  <th className="pb-1 text-right font-medium">Vol.</th>
                </tr>
              </thead>
              <tbody className="chiffre">
                {reponse.chandeliers.map((bougie) => (
                  <tr key={bougie.horodatage} className="border-t border-bordure/60">
                    <td className="py-1">
                      {new Date(bougie.horodatage * 1000).toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="py-1 text-right">{bougie.ouverture}</td>
                    <td className="py-1 text-right">{bougie.haut}</td>
                    <td className="py-1 text-right">{bougie.bas}</td>
                    <td className="py-1 text-right">{bougie.cloture}</td>
                    <td className="py-1 text-right">{bougie.volume ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {reponse.incidents && reponse.incidents.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-texte-attenue">
              {reponse.incidents.map((incident, index) => (
                <li key={index}>
                  <span className="chiffre">{incident.fournisseur}</span> — {incident.raison}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Panneau>
  );
}
