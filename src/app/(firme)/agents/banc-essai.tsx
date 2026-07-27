'use client';

import { useState, useTransition } from 'react';

import { soumettreProposition, type ResultatProposition } from '@/app/actions/propositions';
import { Panneau } from '@/composants/ui/panneau';

/**
 * Banc d'essai des permissions.
 *
 * L'orchestrateur des cycles n'existe pas encore (phase 4b), mais le chemin de
 * décision, lui, est complet. Cet écran l'emprunte tel quel : même action
 * serveur, mêmes deux barrières, mêmes écritures. Ce qu'on voit ici est
 * exactement ce qui se produira quand l'agent proposera de lui-même.
 */

export interface AgentOption {
  readonly cle: string;
  readonly nom: string;
  readonly niveau: string;
}

const INTERVALLES = ['M5', 'M15', 'H1'] as const;

export function BancEssai({
  agents,
  symboles,
}: {
  agents: readonly AgentOption[];
  symboles: readonly string[];
}) {
  const [agentCle, setAgentCle] = useState(agents[0]?.cle ?? '');
  const [symbole, setSymbole] = useState(symboles[0] ?? 'EURUSD');
  const [intervalle, setIntervalle] = useState<(typeof INTERVALLES)[number]>('M5');
  const [sens, setSens] = useState<'ACHAT' | 'VENTE'>('ACHAT');
  const [quantite, setQuantite] = useState('0.10');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [confiance, setConfiance] = useState('70');
  const [resultat, setResultat] = useState<ResultatProposition | null>(null);
  const [enCours, demarrer] = useTransition();

  function nombreOuNull(valeur: string): number | null {
    const brut = valeur.trim();
    if (brut === '') return null;
    const nombre = Number.parseFloat(brut.replace(',', '.'));
    return Number.isFinite(nombre) ? nombre : null;
  }

  function soumettre() {
    demarrer(async () => {
      setResultat(
        await soumettreProposition({
          agentCle,
          symbole,
          intervalle,
          sens,
          type: 'MARCHE',
          quantite,
          prixDemande: null,
          stopLoss: nombreOuNull(stopLoss),
          takeProfit: nombreOuNull(takeProfit),
          confiance: nombreOuNull(confiance),
          raisonnement: 'Proposition émise depuis le banc d’essai des permissions.',
        }),
      );
    });
  }

  const couleurVerdict =
    resultat?.verdict === 'AUTONOME'
      ? 'text-hausse'
      : resultat?.verdict === 'VALIDATION_REQUISE'
        ? 'text-accent'
        : 'text-baisse';

  return (
    <Panneau titre="Banc d’essai — faire proposer un agent">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[0.72rem] text-texte-attenue">Agent</span>
          <select
            value={agentCle}
            onChange={(evenement) => setAgentCle(evenement.target.value)}
            className="rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent"
          >
            {agents.map((agent) => (
              <option key={agent.cle} value={agent.cle}>
                {agent.nom} — {agent.niveau.toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.72rem] text-texte-attenue">Instrument</span>
          <select
            value={symbole}
            onChange={(evenement) => setSymbole(evenement.target.value)}
            className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent"
          >
            {symboles.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.72rem] text-texte-attenue">Intervalle</span>
          <select
            value={intervalle}
            onChange={(evenement) =>
              setIntervalle(evenement.target.value as (typeof INTERVALLES)[number])
            }
            className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent"
          >
            {INTERVALLES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-1">
          {(['ACHAT', 'VENTE'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSens(option)}
              className={[
                'chiffre rounded px-2.5 py-1.5 text-xs uppercase tracking-wider transition-colors',
                sens === option
                  ? option === 'ACHAT'
                    ? 'bg-hausse/20 text-hausse'
                    : 'bg-baisse/20 text-baisse'
                  : 'border border-bordure text-texte-attenue hover:text-texte',
              ].join(' ')}
            >
              {option}
            </button>
          ))}
        </div>

        {[
          { libelle: 'Lots', valeur: quantite, definir: setQuantite, pas: '0.01' },
          { libelle: 'Stop-loss', valeur: stopLoss, definir: setStopLoss, pas: 'any' },
          { libelle: 'Objectif', valeur: takeProfit, definir: setTakeProfit, pas: 'any' },
          { libelle: 'Confiance', valeur: confiance, definir: setConfiance, pas: '5' },
        ].map((champ) => (
          <label key={champ.libelle} className="flex flex-col gap-1">
            <span className="text-[0.72rem] text-texte-attenue">{champ.libelle}</span>
            <input
              type="number"
              step={champ.pas}
              value={champ.valeur}
              onChange={(evenement) => champ.definir(evenement.target.value)}
              className="chiffre w-24 rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent"
            />
          </label>
        ))}

        <button
          type="button"
          disabled={enCours || agentCle === ''}
          onClick={soumettre}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-fond disabled:opacity-40"
        >
          {enCours ? 'Évaluation…' : 'Soumettre'}
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-texte-attenue">
        Sans stop-loss, l’ordre est rejeté par les garde-fous : c’est voulu, et c’est un bon
        premier test. La proposition traverse le même chemin que celui de l’orchestrateur et
        laisse les mêmes traces dans l’historique.
      </p>

      {resultat ? (
        <div className="mt-3 border-t border-bordure pt-3">
          <p className={`text-xs ${resultat.ok ? couleurVerdict : 'text-baisse'}`} role="status">
            {resultat.message}
          </p>
          {resultat.controles.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {resultat.controles.map((controle, index) => (
                <li
                  key={`${controle.origine}-${controle.code}-${index}`}
                  className="chiffre flex flex-wrap items-baseline gap-2 text-xs"
                >
                  <span className="text-texte-attenue">
                    {controle.origine === 'PERMISSION' ? 'droit' : 'risque'}
                  </span>
                  <span
                    className={
                      controle.statut === 'REFUSE'
                        ? 'text-baisse'
                        : controle.statut === 'REDUIT' || controle.statut === 'VALIDATION'
                          ? 'text-alerte'
                          : 'text-texte-attenue'
                    }
                  >
                    {controle.libelle}
                  </span>
                  <span className="text-texte-attenue">{controle.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Panneau>
  );
}
