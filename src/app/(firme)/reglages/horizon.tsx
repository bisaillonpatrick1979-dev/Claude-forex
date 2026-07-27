'use client';

import { useState, useTransition } from 'react';

import { changerHorizon } from '@/app/actions/firme';
import { HORIZONS, PROFILS_HORIZON, type Horizon } from '@/lib/agents/horizons';

/**
 * Choix de l'horizon pratiqué.
 *
 * L'écran montre la viabilité par instrument à côté du choix, parce que c'est
 * la seule information qui rende le choix éclairé : décider de scalper sans
 * savoir que le spread mange les trois quarts du mouvement visé sur la moitié
 * des instruments, c'est décider à l'aveugle.
 */

export interface ViabiliteAffichee {
  readonly symbole: string;
  readonly viable: boolean;
  readonly partCoutsPct: number;
  readonly explication: string;
}

export function ChoixHorizon({
  actif,
  viabilites,
}: {
  actif: Horizon;
  viabilites: Readonly<Record<string, readonly ViabiliteAffichee[]>>;
}) {
  const [horizon, setHorizon] = useState<Horizon>(actif);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const profil = PROFILS_HORIZON[horizon];
  const liste = viabilites[horizon] ?? [];
  const praticables = liste.filter((ligne) => ligne.viable);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {HORIZONS.map((code) => (
          <button
            key={code}
            type="button"
            disabled={enCours}
            onClick={() => {
              setHorizon(code);
              setMessage(null);
            }}
            className={`rounded border px-3 py-1.5 text-sm ${
              horizon === code
                ? 'border-accent bg-accent/10 text-texte'
                : 'border-bordure text-texte-attenue'
            }`}
          >
            {PROFILS_HORIZON[code].nom}
          </button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-texte-attenue">{profil.resume}</p>

      <div className="chiffre grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-texte-attenue sm:grid-cols-4">
        <span>Décision : {profil.intervalleDecision}</span>
        <span>Fond : {profil.intervalleContexte}</span>
        <span>
          Stop {profil.multipleStopAtr} / cible {profil.multipleCibleAtr} ATR
        </span>
        <span>{profil.tradesMaxParJour} trades/jour</span>
      </div>

      {liste.length > 0 ? (
        <div className="rounded border border-bordure/60 px-3 py-2 text-xs">
          <p className="mb-1.5 text-texte-attenue">
            Praticable sur{' '}
            <span className={praticables.length === 0 ? 'text-alerte' : 'text-texte'}>
              {praticables.length} instrument{praticables.length > 1 ? 's' : ''} sur {liste.length}
            </span>{' '}
            — les frais doivent rester sous {Math.round(profil.partCoutsToleree * 100)} % du gain
            visé.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {liste.map((ligne) => (
              <span
                key={ligne.symbole}
                title={ligne.explication}
                className={`chiffre ${ligne.viable ? 'text-hausse' : 'text-texte-attenue line-through'}`}
              >
                {ligne.symbole} {ligne.partCoutsPct}&nbsp;%
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={enCours || horizon === actif}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-fond disabled:opacity-50"
          onClick={() =>
            demarrer(async () => {
              const resultat = await changerHorizon(horizon);
              setMessage(
                resultat.ok
                  ? `Horizon ${PROFILS_HORIZON[horizon].nom.toLowerCase()} appliqué.`
                  : (resultat.message ?? 'Échec.'),
              );
            })
          }
        >
          {horizon === actif ? 'Horizon actif' : 'Appliquer'}
        </button>
        {message ? <span className="text-xs text-texte-attenue">{message}</span> : null}
      </div>
    </div>
  );
}
