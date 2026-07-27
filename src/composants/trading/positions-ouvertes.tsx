'use client';

import { useState, useTransition } from 'react';

import { avancerMarche, fermerPositionManuelle } from '@/app/actions/trading';
import { EtatVide } from '@/composants/ui/panneau';
import { couleurPnl, formaterMonnaie } from '@/lib/format';
import type { Intervalle } from '@/lib/marche/types';

export interface PositionAffichee {
  readonly id: string;
  readonly symbole: string;
  readonly sens: 'ACHAT' | 'VENTE';
  readonly quantite: number;
  readonly prixEntree: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly tailleContrat: number;
  readonly decimales: number;
}

export interface OrdreAffiche {
  readonly id: string;
  readonly symbole: string;
  readonly sens: 'ACHAT' | 'VENTE';
  readonly type: string;
  readonly quantite: number;
  readonly prixDemande: number | null;
  readonly statut: string;
}

/**
 * Le P&L latent est recalculé côté navigateur à partir du dernier prix du
 * graphique, pour rester en phase avec ce qui est affiché. La valeur qui fait
 * foi reste celle du serveur, écrite au grand livre à la fermeture.
 */
export function PositionsOuvertes({
  positions,
  dernierPrix,
  symboleCourant,
  intervalle,
}: {
  positions: readonly PositionAffichee[];
  dernierPrix: number | null;
  symboleCourant: string;
  intervalle: Intervalle;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  if (positions.length === 0) {
    return <EtatVide message="Aucune position ouverte." />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {positions.map((position) => {
        const memeInstrument = position.symbole === symboleCourant && dernierPrix !== null;
        const latent = memeInstrument
          ? (position.sens === 'ACHAT'
              ? dernierPrix - position.prixEntree
              : position.prixEntree - dernierPrix) *
            position.tailleContrat *
            position.quantite
          : null;

        return (
          <div key={position.id} className="rounded border border-bordure bg-panneau-clair px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="chiffre text-xs">
                <span className={position.sens === 'ACHAT' ? 'text-hausse' : 'text-baisse'}>
                  {position.sens === 'ACHAT' ? '▲' : '▼'}
                </span>{' '}
                {position.symbole} {position.quantite}
              </span>
              <span className={`chiffre text-xs ${couleurPnl(latent)}`}>
                {latent === null ? '—' : formaterMonnaie(latent)}
              </span>
            </div>

            <div className="chiffre mt-0.5 flex flex-wrap gap-x-2 text-[0.72rem] text-texte-attenue">
              <span>entrée {position.prixEntree.toFixed(position.decimales)}</span>
              <span>
                stop {position.stopLoss === null ? '—' : position.stopLoss.toFixed(position.decimales)}
              </span>
              <span>
                cible{' '}
                {position.takeProfit === null ? '—' : position.takeProfit.toFixed(position.decimales)}
              </span>
              <button
                type="button"
                disabled={enCours}
                onClick={() =>
                  demarrer(async () => {
                    const resultat = await fermerPositionManuelle(
                      position.id,
                      position.symbole,
                      intervalle,
                    );
                    setMessage(resultat.message);
                  })
                }
                className="ml-auto text-[0.72rem] text-texte-attenue underline-offset-4 hover:text-texte hover:underline disabled:opacity-40"
              >
                Fermer
              </button>
            </div>
          </div>
        );
      })}

      {message ? <p className="text-[0.72rem] text-texte-attenue">{message}</p> : null}
    </div>
  );
}

export function OrdresEnAttente({
  ordres,
  symboleCourant,
  intervalle,
}: {
  ordres: readonly OrdreAffiche[];
  symboleCourant: string;
  intervalle: Intervalle;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      {ordres.length === 0 ? (
        <EtatVide message="Aucun ordre en attente." />
      ) : (
        ordres.map((ordre) => (
          <div key={ordre.id} className="rounded border border-bordure bg-panneau-clair px-2 py-1.5">
            <div className="chiffre flex items-baseline justify-between gap-2 text-xs">
              <span>
                <span className={ordre.sens === 'ACHAT' ? 'text-hausse' : 'text-baisse'}>
                  {ordre.sens === 'ACHAT' ? '▲' : '▼'}
                </span>{' '}
                {ordre.symbole} {ordre.quantite}
              </span>
              <span className="text-[0.72rem] text-texte-attenue">
                {ordre.type.toLowerCase()}
                {ordre.prixDemande !== null ? ` @ ${ordre.prixDemande}` : ''}
              </span>
            </div>
            <p className="chiffre mt-0.5 text-[0.72rem] text-texte-attenue">
              {ordre.statut === 'PARTIELLEMENT_REMPLI'
                ? 'partiellement rempli'
                : 'en attente de la prochaine bougie'}
            </p>
          </div>
        ))
      )}

      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          demarrer(async () => {
            const resultat = await avancerMarche(symboleCourant, intervalle);
            setMessage(resultat.message);
          })
        }
        title="Fait passer le moteur sur les bougies fermées non encore traitées"
        className="rounded border border-bordure px-2 py-1 text-[0.72rem] uppercase tracking-wider text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
      >
        {enCours ? 'Traitement…' : 'Traiter le marché'}
      </button>

      {message ? <p className="text-[0.72rem] text-texte-attenue">{message}</p> : null}
    </div>
  );
}
