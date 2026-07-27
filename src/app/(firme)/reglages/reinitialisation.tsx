'use client';

import { useState, useTransition } from 'react';

import { ajusterCapital, reinitialiserFirme } from '@/app/actions/reinitialisation';
import { formaterMonnaie } from '@/lib/format';

/**
 * Ajustement du capital et réinitialisation.
 *
 * Deux actions séparées parce que les intentions n'ont rien à voir : ajuster
 * une dotation en cours de route n'a aucune raison de détruire l'historique.
 * Les fusionner sous un même bouton ferait perdre des données à quelqu'un qui
 * voulait seulement changer un montant.
 *
 * La réinitialisation exige de retaper le montant à la main. Une case à cocher
 * se coche sans lire ; retaper « 100000 » suppose qu'on a compris ce qu'on
 * fait. C'est la même exigence que celle prévue pour le futur mode réel.
 */

export function Reinitialisation({
  capitalActuel,
  devise,
  nombreLecons,
  nombreCycles,
}: {
  capitalActuel: number;
  devise: string;
  nombreLecons: number;
  nombreCycles: number;
}) {
  const [capital, setCapital] = useState(String(capitalActuel));
  const [confirmation, setConfirmation] = useState('');
  const [conserverLecons, setConserverLecons] = useState(true);
  const [effacerHistorique, setEffacerHistorique] = useState(true);
  const [retour, setRetour] = useState<{ ok: boolean; message: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const lancer = (action: () => Promise<{ ok: boolean; message: string }>) => {
    setRetour(null);
    demarrer(async () => setRetour(await action()));
  };

  const montantVoulu = Number(capital);
  const montantValide = Number.isFinite(montantVoulu) && montantVoulu > 0;
  const confirmationOk = confirmation.trim() === capital.trim() && montantValide;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <section>
        <h3 className="mb-1 text-sm">Capital du portefeuille</h3>
        <p className="mb-2 text-xs text-texte-attenue">
          Actuellement {formaterMonnaie(capitalActuel, devise)}. Le modifier décale le solde et
          l’équité du même montant : les gains et pertes déjà réalisés restent intacts, rien
          n’est effacé.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="number"
            min={1}
            step="100"
            value={capital}
            onChange={(evenement) => setCapital(evenement.target.value)}
            aria-label="Capital du portefeuille"
            className="chiffre min-w-0 flex-1 rounded border border-bordure bg-panneau-clair px-2.5 py-2 text-sm"
          />
          <button
            type="button"
            disabled={enCours || !montantValide}
            onClick={() => lancer(() => ajusterCapital(montantVoulu))}
            className="rounded border border-bordure-vive px-3 py-2 text-xs transition hover:border-accent disabled:opacity-40"
          >
            Ajuster sans rien effacer
          </button>
        </div>
      </section>

      <section className="rounded border border-baisse/40 bg-baisse/5 p-3">
        <h3 className="mb-1 text-sm text-baisse">Réinitialiser</h3>
        <p className="mb-3 text-xs text-texte-attenue">
          Remet le portefeuille au capital saisi ci-dessus et efface au choix l’historique de
          trading. Irréversible.
        </p>

        <div className="mb-3 flex flex-col gap-2">
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={effacerHistorique}
              onChange={(evenement) => setEffacerHistorique(evenement.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-baisse)]"
            />
            <span>
              Effacer l’historique de trading — {nombreCycles} cycle(s), leurs positions, ordres
              et transactions. Décoché, seul le portefeuille est remis à niveau.
            </span>
          </label>

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={conserverLecons}
              onChange={(evenement) => setConserverLecons(evenement.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            />
            <span>
              Conserver les {nombreLecons} leçon(s) des agents. C’est ce qu’ils ont appris de
              leurs positions passées ; le décocher les fait repartir sans mémoire.
            </span>
          </label>
        </div>

        <p className="mb-2 text-xs text-texte-attenue">
          Pour confirmer, retapez le montant exactement : <span className="chiffre">{capital}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={confirmation}
            onChange={(evenement) => setConfirmation(evenement.target.value)}
            placeholder="Retaper le montant"
            aria-label="Confirmation du montant"
            className="chiffre min-w-0 flex-1 rounded border border-bordure bg-panneau-clair px-2.5 py-2 text-sm"
          />
          <button
            type="button"
            disabled={enCours || !confirmationOk}
            onClick={() =>
              lancer(async () => {
                const resultat = await reinitialiserFirme({
                  capital: montantVoulu,
                  conserverLecons,
                  effacerHistorique,
                });
                setConfirmation('');
                return resultat;
              })
            }
            className="rounded bg-baisse px-3 py-2 text-xs font-medium text-fond transition hover:opacity-90 disabled:opacity-40"
          >
            Réinitialiser
          </button>
        </div>

        <p className="chiffre mt-2 text-[0.72rem] text-texte-attenue/70">
          Jamais touchés : vos clés API, les agents et leurs mandats, leurs permissions, les
          playbooks de stratégie et le journal d’audit.
        </p>
      </section>

      {retour ? (
        <p
          className={`rounded border px-2.5 py-2 text-xs ${
            retour.ok
              ? 'border-hausse/40 bg-hausse/10 text-hausse'
              : 'border-baisse/40 bg-baisse/10 text-baisse'
          }`}
        >
          {retour.message}
        </p>
      ) : null}
    </div>
  );
}
