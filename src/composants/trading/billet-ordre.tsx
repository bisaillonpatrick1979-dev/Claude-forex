'use client';

import { useState, useTransition } from 'react';

import { passerOrdreManuel, type ResultatTrading } from '@/app/actions/trading';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Billet d'ordre manuel.
 *
 * Le stop-loss est un champ obligatoire dans le formulaire, mais ce n'est pas
 * l'interface qui fait respecter la règle : le serveur rejette de toute façon
 * un ordre sans stop. Une validation côté navigateur ne protège de rien.
 */

const TYPES = ['MARCHE', 'LIMITE', 'STOP'] as const;

export function BilletOrdre({
  symbole,
  intervalle,
  dernierPrix,
  decimales,
}: {
  symbole: string;
  intervalle: Intervalle;
  dernierPrix: number | null;
  decimales: number;
}) {
  const [sens, setSens] = useState<'ACHAT' | 'VENTE'>('ACHAT');
  const [type, setType] = useState<(typeof TYPES)[number]>('MARCHE');
  const [quantite, setQuantite] = useState('0.10');
  const [prixDemande, setPrixDemande] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [resultat, setResultat] = useState<ResultatTrading | null>(null);
  const [enCours, demarrer] = useTransition();

  function nombreOuNull(valeur: string): number | null {
    const brut = valeur.trim();
    if (brut === '') return null;
    const nombre = Number.parseFloat(brut);
    return Number.isFinite(nombre) ? nombre : null;
  }

  function soumettre() {
    demarrer(async () => {
      setResultat(
        await passerOrdreManuel({
          symbole,
          intervalle,
          sens,
          type,
          quantite,
          prixDemande: type === 'MARCHE' ? null : nombreOuNull(prixDemande),
          stopLoss: nombreOuNull(stopLoss),
          takeProfit: nombreOuNull(takeProfit),
        }),
      );
    });
  }

  const suggestion = dernierPrix !== null ? dernierPrix.toFixed(decimales) : '—';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {(['ACHAT', 'VENTE'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSens(option)}
            className={[
              'chiffre flex-1 rounded px-2 py-1.5 text-[11px] uppercase tracking-wider transition-colors',
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

      <div className="flex gap-1">
        {TYPES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            className={[
              'chiffre flex-1 rounded border px-1.5 py-1 text-[10px] uppercase tracking-wider transition-colors',
              type === option
                ? 'border-bordure-vive text-texte'
                : 'border-bordure text-texte-attenue hover:text-texte',
            ].join(' ')}
          >
            {option}
          </button>
        ))}
      </div>

      <Champ libelle="Taille (lots)" valeur={quantite} onChange={setQuantite} placeholder="0.10" />
      {type !== 'MARCHE' ? (
        <Champ
          libelle="Prix"
          valeur={prixDemande}
          onChange={setPrixDemande}
          placeholder={suggestion}
        />
      ) : null}
      <Champ
        libelle="Stop-loss (obligatoire)"
        valeur={stopLoss}
        onChange={setStopLoss}
        placeholder={suggestion}
      />
      <Champ
        libelle="Take-profit"
        valeur={takeProfit}
        onChange={setTakeProfit}
        placeholder="facultatif"
      />

      <button
        type="button"
        onClick={soumettre}
        disabled={enCours}
        className="rounded bg-accent px-2.5 py-1.5 text-[11px] font-medium text-fond transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {enCours ? 'Contrôle du risque…' : `Proposer ${sens.toLowerCase()} ${symbole}`}
      </button>

      <p className="text-[10px] leading-snug text-texte-attenue">
        L’ordre est contrôlé par le moteur de risque, puis rempli sur la bougie suivante — jamais
        sur celle qui a servi à décider.
      </p>

      {resultat ? (
        <div
          className={`rounded border px-2 py-1.5 text-[11px] ${
            resultat.ok ? 'border-bordure bg-panneau-clair text-texte-attenue' : 'border-baisse/40 bg-baisse/10 text-baisse'
          }`}
          role={resultat.ok ? undefined : 'alert'}
        >
          <p>{resultat.message}</p>
          {resultat.controles && resultat.controles.length > 0 ? (
            <ul className="chiffre mt-1 flex flex-col gap-0.5 text-[10px] text-texte-attenue">
              {resultat.controles.map((controle) => (
                <li key={controle.code}>
                  {controle.statut === 'OK' ? '·' : '!'} {controle.libelle} — {controle.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Champ({
  libelle,
  valeur,
  onChange,
  placeholder,
}: {
  libelle: string;
  valeur: string;
  onChange: (valeur: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-texte-attenue">{libelle}</span>
      <input
        type="text"
        inputMode="decimal"
        value={valeur}
        placeholder={placeholder}
        onChange={(evenement) => onChange(evenement.target.value)}
        className="chiffre w-24 rounded border border-bordure bg-fond px-2 py-1 text-right text-xs outline-none focus:border-accent"
      />
    </label>
  );
}
