'use client';

import { useState, useTransition } from 'react';

import { changerMode } from '@/app/actions/firme';
import type { ModeOperation } from '@/lib/config/drapeaux';
import { DESCRIPTIONS_MODES } from '@/lib/config/modes';

const ORDRE: readonly ModeOperation[] = ['PAPIER_AUTONOME', 'PAPIER_VALIDATION', 'REEL_VALIDATION'];

/**
 * Sélecteur de mode. Le mode réel apparaît, désactivé : le cacher laisserait
 * croire qu'il n'existe pas, alors que le point est justement de montrer qu'il
 * est verrouillé.
 */
export function SelecteurMode({
  modeCourant,
  modesAutorises,
}: {
  modeCourant: ModeOperation;
  modesAutorises: readonly ModeOperation[];
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function choisir(mode: ModeOperation) {
    if (mode === modeCourant) return;
    demarrer(async () => {
      const resultat = await changerMode(mode);
      setErreur(resultat.ok ? null : (resultat.message ?? 'Changement refusé.'));
    });
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded border border-bordure bg-fond p-0.5">
        {ORDRE.map((mode) => {
          const autorise = modesAutorises.includes(mode);
          const actif = mode === modeCourant;
          return (
            <button
              key={mode}
              type="button"
              disabled={!autorise || enCours}
              onClick={() => choisir(mode)}
              title={DESCRIPTIONS_MODES[mode].description}
              className={[
                'chiffre rounded px-2 py-1 text-xs uppercase tracking-wider transition-colors',
                actif ? 'bg-panneau-clair text-texte' : 'text-texte-attenue',
                autorise ? 'hover:text-texte' : 'cursor-not-allowed opacity-40',
              ].join(' ')}
            >
              {DESCRIPTIONS_MODES[mode].libelle}
            </button>
          );
        })}
      </div>
      {erreur ? <span className="text-xs text-baisse">{erreur}</span> : null}
    </div>
  );
}
