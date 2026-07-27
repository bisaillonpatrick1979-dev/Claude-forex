'use client';

import { useState, useTransition } from 'react';

import { enregistrerLimites } from '@/app/actions/risque';
import {
  CHAMPS_LIMITES,
  validerLimites,
  type CleLimite,
  type ValeursLimites,
} from '@/lib/config/limites';

/**
 * Édition des limites de risque et du budget IA.
 *
 * La validation tourne dans le navigateur **et** sur le serveur, à partir de la
 * même fonction. Ce n'est pas de la duplication : celle du navigateur sert à
 * dire tout de suite ce qui ne va pas, celle du serveur est la seule qui
 * protège — le formulaire n'est pas le chemin obligé vers l'action.
 *
 * Les valeurs sont gardées en texte tant que le champ est en cours de saisie.
 * Les convertir en nombre à chaque frappe rend un champ inutilisable dès qu'on
 * veut effacer pour retaper : « 5 » devient 5, effacer donne NaN, et le champ
 * se remplit tout seul d'un zéro.
 */

export function FormulaireLimites({ valeurs }: { valeurs: ValeursLimites }) {
  const [saisie, setSaisie] = useState<Record<CleLimite, string>>(() => enTexte(valeurs));
  const [retour, setRetour] = useState<{ ok: boolean; message: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const validation = validerLimites(saisie);
  const modifie = CHAMPS_LIMITES.some(
    (champ) => saisie[champ.cle].trim() !== String(valeurs[champ.cle]),
  );

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        setRetour(null);
        demarrer(async () => {
          const resultat = await enregistrerLimites(saisie);
          setRetour({
            ok: resultat.ok,
            message: resultat.message ?? (resultat.ok ? 'Enregistré.' : 'Échec.'),
          });
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {CHAMPS_LIMITES.map((champ) => {
          const erreur = validation.erreurs[champ.cle];
          return (
            <label
              key={champ.cle}
              className={`flex flex-col gap-1 rounded border px-2.5 py-2 ${
                erreur ? 'border-alerte/60' : 'border-bordure/60'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-texte-attenue">{champ.libelle}</span>
                <span className="text-[0.65rem] text-texte-attenue">
                  {champ.min} – {champ.max} {champ.unite}
                </span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={champ.pas}
                min={champ.min}
                max={champ.max}
                value={saisie[champ.cle]}
                disabled={enCours}
                onChange={(evenement) => {
                  const valeur = evenement.target.value;
                  setSaisie((precedent) => ({ ...precedent, [champ.cle]: valeur }));
                  setRetour(null);
                }}
                className="chiffre w-full rounded border border-bordure bg-transparent px-2 py-1 text-sm text-texte outline-none focus:border-accent"
              />
              <span className={`text-[0.65rem] leading-snug ${erreur ? 'text-alerte' : 'text-texte-attenue'}`}>
                {erreur ?? champ.aide}
              </span>
            </label>
          );
        })}
      </div>

      {validation.incoherences.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded border border-alerte/40 bg-alerte/10 px-3 py-2 text-xs leading-relaxed text-alerte">
          {validation.incoherences.map((texte) => (
            <li key={texte}>{texte}</li>
          ))}
        </ul>
      ) : null}

      {retour ? (
        <p
          className={`rounded border px-3 py-2 text-xs leading-relaxed ${
            retour.ok
              ? 'border-hausse/40 bg-hausse/10 text-hausse'
              : 'border-alerte/40 bg-alerte/10 text-alerte'
          }`}
        >
          {retour.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={enCours || !validation.ok || !modifie}
          className="rounded border border-accent bg-accent/10 px-3 py-1.5 text-sm text-texte disabled:border-bordure disabled:bg-transparent disabled:text-texte-attenue"
        >
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          disabled={enCours || !modifie}
          onClick={() => {
            setSaisie(enTexte(valeurs));
            setRetour(null);
          }}
          className="rounded border border-bordure px-3 py-1.5 text-sm text-texte-attenue disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

function enTexte(valeurs: ValeursLimites): Record<CleLimite, string> {
  return Object.fromEntries(
    CHAMPS_LIMITES.map((champ) => [champ.cle, String(valeurs[champ.cle])]),
  ) as Record<CleLimite, string>;
}
