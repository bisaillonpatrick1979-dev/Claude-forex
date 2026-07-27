'use client';

import { useState, useTransition } from 'react';

import { declencherKillSwitch, leverKillSwitch } from '@/app/actions/firme';

/**
 * Arrêt d'urgence, accessible depuis n'importe quelle page.
 *
 * Une confirmation, mais une seule : un kill switch qui demande trois clics
 * n'est pas un kill switch. Le dégel, lui, est un bouton distinct et discret.
 */
export function KillSwitch({ gele }: { gele: boolean }) {
  const [confirmation, setConfirmation] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function arreter() {
    demarrer(async () => {
      const resultat = await declencherKillSwitch();
      setMessage(resultat.message ?? (resultat.ok ? 'Firme arrêtée.' : 'Échec de l’arrêt.'));
      setConfirmation(false);
    });
  }

  function degeler() {
    demarrer(async () => {
      const resultat = await leverKillSwitch();
      setMessage(resultat.message ?? null);
    });
  }

  if (gele) {
    return (
      <div className="flex items-center gap-2">
        <span className="chiffre rounded border border-baisse/50 bg-baisse/10 px-2 py-1 text-xs uppercase tracking-wider text-baisse">
          Firme gelée
        </span>
        <button
          type="button"
          onClick={degeler}
          disabled={enCours}
          className="text-xs text-texte-attenue underline-offset-4 hover:underline disabled:opacity-50"
        >
          Dégeler
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      {message ? <span className="hidden text-xs text-texte-attenue sm:inline">{message}</span> : null}

      {confirmation ? (
        <>
          <button
            type="button"
            onClick={arreter}
            disabled={enCours}
            className="chiffre rounded bg-baisse px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-white disabled:opacity-50"
          >
            {enCours ? 'Arrêt…' : 'Confirmer l’arrêt'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmation(false)}
            className="text-xs text-texte-attenue underline-offset-4 hover:underline"
          >
            Annuler
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmation(true)}
          title="Arrête les agents, annule les ordres en attente et gèle le portefeuille"
          className="chiffre rounded border border-baisse/50 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-baisse transition-colors hover:bg-baisse/10"
        >
          Kill switch
        </button>
      )}
    </div>
  );
}
