'use client';

import { useState, useTransition } from 'react';

import { importerPourBacktest, lancerBacktest } from '@/app/actions/backtest';
import { STRATEGIES } from '@/lib/backtest/strategies';
import { Panneau } from '@/composants/ui/panneau';

/**
 * Console de backtest.
 *
 * Deux boutons séparés, et l'écran dit pourquoi : importer dépense du quota
 * chez le fournisseur, rejouer ne coûte rien. Les réunir ferait payer une
 * requête réseau à chaque essai de paramètre.
 */

const INTERVALLES = ['D1', 'H4', 'H1', 'M30', 'M15'] as const;

const CLASSE_CHAMP =
  'w-full rounded border border-bordure bg-fond px-2 py-1.5 text-sm text-texte outline-none focus:border-accent';

const CLASSE_BOUTON =
  'rounded bg-accent px-3 py-1.5 text-sm font-medium text-fond disabled:opacity-50';

const CLASSE_BOUTON_SECONDAIRE =
  'rounded border border-bordure px-3 py-1.5 text-sm text-texte disabled:opacity-50';

export interface OptionSymbole {
  readonly code: string;
  readonly libelle: string;
}

export function ConsoleBacktest({
  symboles,
  historique,
}: {
  symboles: readonly OptionSymbole[];
  historique: Readonly<Record<string, { bougies: number; source: string; debut: string } | undefined>>;
}) {
  const [symbole, setSymbole] = useState(symboles[0]?.code ?? 'EURUSD');
  const [intervalle, setIntervalle] = useState<string>('D1');
  const [strategie, setStrategie] = useState<string>(STRATEGIES[0]!.code);
  const [capital, setCapital] = useState(100_000);
  const [annees, setAnnees] = useState(15);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const cle = `${symbole}|${intervalle}`;
  const dispo = historique[cle];

  return (
    <Panneau>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Champ etiquette="Instrument">
          <select className={CLASSE_CHAMP} value={symbole} onChange={(e) => setSymbole(e.target.value)}>
            {symboles.map((option) => (
              <option key={option.code} value={option.code}>
                {option.libelle}
              </option>
            ))}
          </select>
        </Champ>

        <Champ etiquette="Intervalle">
          <select
            className={CLASSE_CHAMP}
            value={intervalle}
            onChange={(e) => setIntervalle(e.target.value)}
          >
            {INTERVALLES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Champ>

        <Champ etiquette="Stratégie">
          <select
            className={CLASSE_CHAMP}
            value={strategie}
            onChange={(e) => setStrategie(e.target.value)}
          >
            {STRATEGIES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.nom}
              </option>
            ))}
          </select>
        </Champ>

        <Champ etiquette="Capital de départ">
          <input
            type="number"
            className={CLASSE_CHAMP}
            value={capital}
            min={1000}
            step={1000}
            onChange={(e) => setCapital(Number(e.target.value))}
          />
        </Champ>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-texte-attenue">
        {STRATEGIES.find((option) => option.code === strategie)?.resume}
      </p>

      <div className="mt-3 rounded border border-bordure/60 px-3 py-2 text-xs">
        {dispo ? (
          <p className="text-texte-attenue">
            <span className="chiffre text-texte">{dispo.bougies.toLocaleString('fr-CA')}</span>{' '}
            bougies en base depuis le {dispo.debut}, source{' '}
            <span className="chiffre">{dispo.source}</span>.
          </p>
        ) : (
          <p className="text-alerte">
            Aucun historique en base pour {symbole} en {intervalle}. Importe-le d’abord.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Champ etiquette="Profondeur à importer">
          <div className="flex items-center gap-2">
            <input
              type="number"
              className={`${CLASSE_CHAMP} w-20`}
              value={annees}
              min={1}
              max={15}
              onChange={(e) => setAnnees(Number(e.target.value))}
            />
            <span className="text-xs text-texte-attenue">ans</span>
          </div>
        </Champ>

        <button
          type="button"
          disabled={enCours}
          className={CLASSE_BOUTON_SECONDAIRE}
          onClick={() =>
            demarrer(async () => {
              const resultat = await importerPourBacktest(symbole, intervalle, annees);
              setMessage({ ok: resultat.ok, texte: resultat.message });
            })
          }
        >
          Importer l’historique
        </button>

        <button
          type="button"
          disabled={enCours || !dispo}
          className={CLASSE_BOUTON}
          onClick={() =>
            demarrer(async () => {
              const resultat = await lancerBacktest(symbole, intervalle, strategie, capital);
              setMessage({ ok: resultat.ok, texte: resultat.message });
            })
          }
        >
          Lancer le backtest
        </button>

        {enCours ? <span className="text-xs text-texte-attenue">En cours…</span> : null}
      </div>

      {/* L'import dépense du quota, le rejeu non : c'est la raison des deux
          boutons, et elle mérite d'être écrite plutôt que devinée. */}
      <p className="mt-2 text-xs text-texte-attenue">
        L’import consomme des requêtes chez le fournisseur ; le rejeu n’en consomme aucune. Une
        série importée peut être rejouée autant de fois qu’on veut.
      </p>

      {message ? (
        <p
          className={`mt-3 rounded border px-3 py-2 text-xs ${
            message.ok
              ? 'border-hausse/40 bg-hausse/10 text-hausse'
              : 'border-alerte/40 bg-alerte/10 text-alerte'
          }`}
        >
          {message.texte}
        </p>
      ) : null}
    </Panneau>
  );
}

function Champ({ etiquette, children }: { etiquette: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-texte-attenue">{etiquette}</span>
      {children}
    </label>
  );
}
