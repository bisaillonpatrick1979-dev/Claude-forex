'use client';

import { useState, useTransition } from 'react';

import {
  approuverProposition,
  refuserProposition,
  type ResultatProposition,
} from '@/app/actions/propositions';
import { EtatVide, Panneau } from '@/composants/ui/panneau';

/**
 * File d'attente : les ordres qu'un agent veut passer et que vous seul pouvez
 * autoriser.
 *
 * Le compte à rebours est affiché parce qu'une proposition périmée n'est pas
 * exécutée en silence : au-delà du délai, le prix qui a servi à la calculer
 * n'existe plus, et l'approbation est refusée.
 */

export interface PropositionAffichee {
  readonly id: string;
  readonly agent: string;
  readonly symbole: string;
  readonly intervalle: string | null;
  readonly sens: 'ACHAT' | 'VENTE';
  readonly type: string;
  readonly quantite: number;
  readonly prixEntree: number | null;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly raisonnement: string;
  readonly creeLe: string;
  readonly valideJusquA: string | null;
  readonly risque: {
    readonly decision: string;
    readonly raison: string;
    readonly risqueEstimePct: number | null;
  } | null;
}

function minutesRestantes(valideJusquA: string | null): number | null {
  if (valideJusquA === null) return null;
  return Math.round((new Date(valideJusquA).getTime() - Date.now()) / 60_000);
}

export function FileValidation({
  propositions,
}: {
  propositions: readonly PropositionAffichee[];
}) {
  if (propositions.length === 0) {
    return (
      <Panneau>
        <EtatVide
          message="Aucune proposition en attente."
          phase="Les agents en niveau « proposition » déposeront leurs ordres ici."
        />
      </Panneau>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {propositions.map((proposition) => (
        <CarteProposition key={proposition.id} proposition={proposition} />
      ))}
    </div>
  );
}

function CarteProposition({ proposition }: { proposition: PropositionAffichee }) {
  const [resultat, setResultat] = useState<ResultatProposition | null>(null);
  const [enCours, demarrer] = useTransition();

  const restant = minutesRestantes(proposition.valideJusquA);
  const expiree = restant !== null && restant <= 0;

  function executer(action: () => Promise<ResultatProposition>) {
    demarrer(async () => setResultat(await action()));
  }

  return (
    <Panneau>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-52 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={`chiffre text-sm uppercase tracking-wider ${
                proposition.sens === 'ACHAT' ? 'text-hausse' : 'text-baisse'
              }`}
            >
              {proposition.sens}
            </span>
            <span className="chiffre text-sm">{proposition.symbole}</span>
            <span className="chiffre text-sm">{proposition.quantite} lot(s)</span>
            <span className="chiffre text-xs text-texte-attenue">
              {proposition.type}
              {proposition.intervalle ? ` · ${proposition.intervalle}` : ''}
            </span>
          </div>
          <p className="chiffre mt-1 text-xs text-texte-attenue">
            proposé par {proposition.agent} ·{' '}
            {new Date(proposition.creeLe).toLocaleTimeString('fr-CA', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {restant !== null ? (
              <span className={expiree ? 'text-baisse' : restant <= 5 ? 'text-alerte' : ''}>
                {' '}
                · {expiree ? 'expirée' : `expire dans ${restant} min`}
              </span>
            ) : null}
          </p>
        </div>

        <dl className="chiffre flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {[
            ['Entrée', proposition.prixEntree],
            ['Stop', proposition.stopLoss],
            ['Objectif', proposition.takeProfit],
          ].map(([libelle, valeur]) => (
            <div key={libelle as string} className="flex flex-col">
              <dt className="text-texte-attenue">{libelle}</dt>
              <dd>{valeur === null ? 'marché' : String(valeur)}</dd>
            </div>
          ))}
          {proposition.risque?.risqueEstimePct !== null &&
          proposition.risque?.risqueEstimePct !== undefined ? (
            <div className="flex flex-col">
              <dt className="text-texte-attenue">Risque</dt>
              <dd>{proposition.risque.risqueEstimePct.toFixed(2)} %</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={enCours || expiree}
            onClick={() => executer(() => approuverProposition(proposition.id))}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-fond disabled:opacity-40"
          >
            Approuver
          </button>
          <button
            type="button"
            disabled={enCours}
            onClick={() => executer(() => refuserProposition(proposition.id))}
            className="rounded border border-bordure px-3 py-1.5 text-xs text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
          >
            Refuser
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-texte-attenue">{proposition.raisonnement}</p>

      {proposition.risque ? (
        <p className="chiffre mt-1 text-xs text-texte-attenue">
          Contrôle de risque à la proposition : {proposition.risque.decision} —{' '}
          {proposition.risque.raison}
        </p>
      ) : null}

      <p className="mt-2 text-xs text-texte-attenue">
        L’approbation refait le contrôle de risque sur le prix du moment : la taille exécutée peut
        être plus petite que celle proposée.
      </p>

      {resultat ? (
        <p
          className={`mt-2 text-xs ${resultat.ok ? 'text-texte' : 'text-baisse'}`}
          role={resultat.ok ? 'status' : 'alert'}
        >
          {resultat.message}
        </p>
      ) : null}
    </Panneau>
  );
}
