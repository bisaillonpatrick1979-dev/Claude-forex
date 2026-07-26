'use client';

import { useActionState, useState } from 'react';

import { connexion, inscription, type EtatFormulaire } from './actions';

const ETAT_INITIAL: EtatFormulaire = {};

export function FormulaireConnexion({ suivant }: { suivant: string }) {
  const [modeInscription, setModeInscription] = useState(false);
  const [etat, action, enAttente] = useActionState<EtatFormulaire, FormData>(
    modeInscription ? inscription : connexion,
    ETAT_INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="suivant" value={suivant} />

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-texte-attenue">Courriel</span>
        <input
          name="courriel"
          type="email"
          autoComplete="email"
          required
          className="rounded border border-bordure bg-fond px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-texte-attenue">Mot de passe</span>
        <input
          name="motDePasse"
          type="password"
          autoComplete={modeInscription ? 'new-password' : 'current-password'}
          required
          minLength={8}
          className="rounded border border-bordure bg-fond px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      {etat.erreur ? (
        <p role="alert" className="rounded border border-baisse/40 bg-baisse/10 px-3 py-2 text-sm">
          {etat.erreur}
        </p>
      ) : null}

      {etat.info ? (
        <p className="rounded border border-bordure bg-panneau-clair px-3 py-2 text-sm text-texte-attenue">
          {etat.info}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enAttente}
        className="rounded bg-accent px-3 py-2 text-sm font-medium text-fond transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {enAttente ? 'Un instant…' : modeInscription ? 'Créer la firme' : 'Entrer'}
      </button>

      <button
        type="button"
        onClick={() => setModeInscription((valeur) => !valeur)}
        className="text-xs text-texte-attenue underline-offset-4 hover:underline"
      >
        {modeInscription ? 'J’ai déjà un compte' : 'Créer un compte'}
      </button>
    </form>
  );
}
