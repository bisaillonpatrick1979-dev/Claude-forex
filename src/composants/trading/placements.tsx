'use client';

import { useState } from 'react';

import { EtatVide } from '@/composants/ui/panneau';
import { couleurPnl, formaterMonnaie } from '@/lib/format';

/**
 * Journal des placements : ce que la firme a réellement fait.
 *
 * Chaque ligne est un fait mesuré — un prix d'entrée, un prix de sortie, un
 * résultat. Rien n'est projeté, rien n'est arrondi en faveur du trader. Une
 * position perdante s'affiche en rouge avec son montant exact, et le motif de
 * sortie dit qui a décidé : un stop touché, une cible atteinte, une
 * liquidation par manque de marge, ou une fermeture à la main.
 *
 * Les positions des agents et les vôtres sont distinguées d'un coup d'œil :
 * sans cela, impossible de savoir si le résultat du mois vient de la firme ou
 * de vos propres ordres.
 */

export interface PlacementAffiche {
  readonly id: string;
  readonly symbole: string;
  readonly classeActif: string;
  readonly sens: 'ACHAT' | 'VENTE';
  readonly quantite: number;
  readonly prixEntree: number;
  readonly prixSortie: number | null;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly pnlRealise: number | null;
  readonly pnlLatent: number;
  readonly statut: 'OUVERTE' | 'FERMEE' | 'LIQUIDEE';
  readonly motif: string | null;
  readonly origine: 'MANUEL' | 'AGENT';
  readonly ouvertLe: string;
  readonly fermeLe: string | null;
  readonly decimales: number;
  readonly devise: string;
  /** Raisonnement de l'agent, quand la position vient d'une proposition. */
  readonly raisonnement: string | null;
}

const LIBELLES_MOTIFS: Readonly<Record<string, string>> = {
  STOP_LOSS: 'stop touché',
  TAKE_PROFIT: 'cible atteinte',
  MANUEL: 'fermé à la main',
  LIQUIDATION: 'liquidé — marge insuffisante',
  EXPIRATION: 'expiré',
};

type Filtre = 'TOUS' | 'AGENT' | 'MANUEL' | 'OUVERTES';

const FILTRES: readonly { code: Filtre; libelle: string }[] = [
  { code: 'TOUS', libelle: 'Tous' },
  { code: 'AGENT', libelle: 'Agents' },
  { code: 'MANUEL', libelle: 'Les miens' },
  { code: 'OUVERTES', libelle: 'Ouvertes' },
];

function horodatage(valeur: string | null): string {
  return valeur === null ? '—' : new Date(valeur).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
}

export function Placements({ placements }: { placements: readonly PlacementAffiche[] }) {
  const [filtre, setFiltre] = useState<Filtre>('TOUS');
  const [ouvert, setOuvert] = useState<string | null>(null);

  const visibles = placements.filter((placement) => {
    if (filtre === 'AGENT') return placement.origine === 'AGENT';
    if (filtre === 'MANUEL') return placement.origine === 'MANUEL';
    if (filtre === 'OUVERTES') return placement.statut === 'OUVERTE';
    return true;
  });

  // Les totaux portent sur ce qui est affiché : filtrer sur « Agents » doit
  // donner le résultat des agents, pas celui du compte entier.
  const realise = visibles.reduce((total, placement) => total + (placement.pnlRealise ?? 0), 0);
  const latent = visibles
    .filter((placement) => placement.statut === 'OUVERTE')
    .reduce((total, placement) => total + placement.pnlLatent, 0);
  const gagnantes = visibles.filter((p) => (p.pnlRealise ?? 0) > 0).length;
  const perdantes = visibles.filter((p) => (p.pnlRealise ?? 0) < 0).length;
  const devise = placements[0]?.devise ?? 'USD';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {FILTRES.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => setFiltre(option.code)}
              className={`rounded border px-2 py-1 text-xs transition ${
                filtre === option.code
                  ? 'border-accent text-accent'
                  : 'border-bordure text-texte-attenue hover:border-bordure-vive'
              }`}
            >
              {option.libelle}
            </button>
          ))}
        </div>

        <p className="chiffre ml-auto text-xs text-texte-attenue">
          {gagnantes} gagnante(s) · {perdantes} perdante(s) · réalisé{' '}
          <span className={couleurPnl(realise)}>{formaterMonnaie(realise, devise)}</span>
          {latent !== 0 ? (
            <>
              {' '}
              · latent <span className={couleurPnl(latent)}>{formaterMonnaie(latent, devise)}</span>
            </>
          ) : null}
        </p>
      </div>

      {visibles.length === 0 ? (
        <EtatVide message="Aucun placement pour ce filtre." />
      ) : (
        <ul className="flex flex-col gap-1">
          {visibles.map((placement) => {
            const resultat =
              placement.statut === 'OUVERTE' ? placement.pnlLatent : placement.pnlRealise;
            const deplie = ouvert === placement.id;

            return (
              <li key={placement.id} className="rounded border border-bordure bg-panneau-clair">
                <button
                  type="button"
                  onClick={() => setOuvert(deplie ? null : placement.id)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-2.5 py-2 text-left"
                >
                  <span
                    className={`chiffre text-xs ${
                      placement.sens === 'ACHAT' ? 'text-hausse' : 'text-baisse'
                    }`}
                  >
                    {placement.sens === 'ACHAT' ? '▲' : '▼'} {placement.symbole}
                  </span>

                  <span className="chiffre text-xs text-texte-attenue">
                    {placement.quantite} lot
                  </span>

                  <span className="chiffre text-xs text-texte-attenue">
                    {placement.prixEntree.toFixed(placement.decimales)}
                    {placement.prixSortie !== null
                      ? ` → ${placement.prixSortie.toFixed(placement.decimales)}`
                      : ' → en cours'}
                  </span>

                  <span
                    className={`rounded px-1.5 py-0.5 text-[0.7rem] ${
                      placement.origine === 'AGENT'
                        ? 'bg-accent/15 text-accent'
                        : 'bg-bordure text-texte-attenue'
                    }`}
                  >
                    {placement.origine === 'AGENT' ? 'agents' : 'moi'}
                  </span>

                  <span className={`chiffre ml-auto text-sm ${couleurPnl(resultat)}`}>
                    {formaterMonnaie(resultat, placement.devise)}
                    {placement.statut === 'OUVERTE' ? ' *' : ''}
                  </span>
                </button>

                {deplie ? (
                  <div className="border-t border-bordure px-2.5 py-2 text-xs text-texte-attenue">
                    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      <Detail libelle="Classe" valeur={placement.classeActif} />
                      <Detail
                        libelle="Statut"
                        valeur={
                          placement.statut === 'OUVERTE'
                            ? 'ouverte'
                            : (LIBELLES_MOTIFS[placement.motif ?? ''] ?? placement.statut.toLowerCase())
                        }
                      />
                      <Detail
                        libelle="Stop-loss"
                        valeur={
                          placement.stopLoss === null
                            ? 'aucun'
                            : placement.stopLoss.toFixed(placement.decimales)
                        }
                      />
                      <Detail
                        libelle="Take-profit"
                        valeur={
                          placement.takeProfit === null
                            ? 'aucun'
                            : placement.takeProfit.toFixed(placement.decimales)
                        }
                      />
                      <Detail libelle="Ouverte le" valeur={horodatage(placement.ouvertLe)} />
                      <Detail libelle="Fermée le" valeur={horodatage(placement.fermeLe)} />
                    </dl>

                    {placement.raisonnement ? (
                      <p className="mt-2 whitespace-pre-wrap border-t border-bordure/60 pt-2 leading-relaxed">
                        {placement.raisonnement}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="chiffre text-[0.7rem] text-texte-attenue/60">
        * résultat latent, au dernier prix traité par le moteur. Les montants réalisés sont nets
        de commissions et de swaps.
      </p>
    </div>
  );
}

function Detail({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-texte-attenue/70">{libelle}</dt>
      <dd className="chiffre">{valeur}</dd>
    </div>
  );
}
