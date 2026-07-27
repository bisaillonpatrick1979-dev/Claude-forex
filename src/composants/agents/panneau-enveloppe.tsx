'use client';

import { useState, useTransition } from 'react';

import {
  confierLaMainAuxAgents,
  definirPerimetreFirme,
  toutMettreEnValidation,
} from '@/app/actions/agents';
import { definirAllocationAgents } from '@/app/actions/cycles';
import { couleurPnl, formaterMonnaie, formaterPourcentage } from '@/lib/format';

/**
 * Poste de commande des agents, dans la salle des marchés.
 *
 * Deux décisions distinctes, volontairement séparées :
 *
 *   - combien je leur confie (l'enveloppe) ;
 *   - est-ce qu'ils peuvent agir seuls (l'autonomie).
 *
 * Les confondre en un seul bouton produirait le pire des malentendus :
 * autoriser l'autonomie en croyant seulement allouer du capital. Confier
 * 10 000 sans donner la main laisse les agents proposer ; donner la main sans
 * confier de capital les laisse analyser sans rien pouvoir engager.
 *
 * Les profits et les pertes sont affichés séparément, jamais en net : un net
 * de +200 peut cacher +5 000 et −4 800, ce qui ne raconte pas la même histoire.
 */

export interface EtatEnveloppe {
  readonly alloue: number;
  readonly profitsRealises: number;
  readonly pertesRealisees: number;
  readonly latent: number;
  readonly valeurCourante: number;
  readonly netRealise: number;
  readonly variationPct: number | null;
  readonly margeEngagee: number;
}

/**
 * Marchés que les agents peuvent traiter.
 *
 * Aucune classe cochée signifie « aucune restriction » — c'est la convention
 * de `evaluerPermission`, et l'inverser ici donnerait deux sémantiques à la
 * même colonne. L'interface le dit en toutes lettres plutôt que de laisser
 * deviner.
 */
const MARCHES: readonly { code: string; libelle: string }[] = [
  { code: 'FOREX', libelle: 'Forex' },
  { code: 'INDICE', libelle: 'Indices (Nasdaq…)' },
  { code: 'ACTION', libelle: 'Actions' },
  { code: 'CRYPTO', libelle: 'Crypto' },
  { code: 'MATIERE_PREMIERE', libelle: 'Matières premières' },
];

export function PanneauEnveloppe({
  enveloppe,
  devise,
  equiteCompte,
  modeOperation,
  agentsAutonomes,
  classesAutorisees,
}: {
  enveloppe: EtatEnveloppe;
  devise: string;
  equiteCompte: number | null;
  modeOperation: string;
  agentsAutonomes: number;
  classesAutorisees: readonly string[];
}) {
  const [montant, setMontant] = useState(String(enveloppe.alloue));
  const [marches, setMarches] = useState<readonly string[]>(classesAutorisees);
  const [retour, setRetour] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const soumettre = (action: () => Promise<{ ok: boolean; message: string }>) => {
    setRetour(null);
    demarrer(async () => {
      const resultat = await action();
      setRetour(resultat.message);
    });
  };

  const laMainEstAuxAgents = modeOperation === 'PAPIER_AUTONOME' && agentsAutonomes > 0;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <label
          htmlFor="allocation-agents"
          className="mb-1 block text-xs text-texte-attenue"
        >
          Capital confié aux agents
        </label>
        <div className="flex gap-2">
          <input
            id="allocation-agents"
            type="number"
            min={0}
            step="100"
            value={montant}
            onChange={(evenement) => setMontant(evenement.target.value)}
            className="chiffre min-w-0 flex-1 rounded border border-bordure bg-panneau-clair px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={enCours}
            onClick={() => soumettre(() => definirAllocationAgents(Number(montant)))}
            className="shrink-0 rounded border border-bordure-vive px-2 py-1 text-xs transition hover:border-accent disabled:opacity-50"
          >
            Confier
          </button>
        </div>
        <p className="chiffre mt-1 text-[0.72rem] text-texte-attenue/70">
          Équité du compte : {formaterMonnaie(equiteCompte, devise)}. Les agents dimensionnent
          leurs positions sur l’enveloppe, pas sur le compte entier.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Cellule
          libelle="Profits réalisés"
          valeur={formaterMonnaie(enveloppe.profitsRealises, devise)}
          classe="text-hausse"
        />
        <Cellule
          libelle="Pertes réalisées"
          valeur={formaterMonnaie(-enveloppe.pertesRealisees, devise)}
          classe="text-baisse"
        />
        <Cellule
          libelle="Latent (positions ouvertes)"
          valeur={formaterMonnaie(enveloppe.latent, devise)}
          classe={couleurPnl(enveloppe.latent)}
        />
        <Cellule
          libelle="Valeur de l’enveloppe"
          valeur={formaterMonnaie(enveloppe.valeurCourante, devise)}
          classe={couleurPnl(enveloppe.valeurCourante - enveloppe.alloue)}
        />
      </div>

      <p className="chiffre text-[0.72rem] text-texte-attenue/70">
        Variation depuis l’allocation : {formaterPourcentage(enveloppe.variationPct)} · marge
        engagée {formaterMonnaie(enveloppe.margeEngagee, devise)}. Le latent vaut au dernier
        horodatage traité par le moteur, pas à la seconde présente.
      </p>

      <div className="border-t border-bordure pt-3">
        <p className="mb-2 text-xs text-texte-attenue">
          Marchés autorisés — rien de coché veut dire « tous ».
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MARCHES.map((marche) => {
            const choisi = marches.includes(marche.code);
            return (
              <button
                key={marche.code}
                type="button"
                onClick={() =>
                  setMarches((actuels) =>
                    choisi
                      ? actuels.filter((code) => code !== marche.code)
                      : [...actuels, marche.code],
                  )
                }
                className={`rounded border px-2 py-1 text-xs transition ${
                  choisi
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-bordure text-texte-attenue hover:border-bordure-vive'
                }`}
              >
                {marche.libelle}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={enCours}
          onClick={() => soumettre(() => definirPerimetreFirme(marches, []))}
          className="mt-2 w-full rounded border border-bordure-vive px-2 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
        >
          {marches.length === 0
            ? 'Autoriser tous les marchés'
            : `Limiter aux ${marches.length} marché(s) choisi(s)`}
        </button>
      </div>

      <div className="border-t border-bordure pt-3">
        <p className="mb-2 text-xs text-texte-attenue">
          {laMainEstAuxAgents
            ? `${agentsAutonomes} agent(s) peuvent ouvrir et fermer sans vous demander.`
            : 'Aucun ordre ne part sans votre validation.'}
        </p>

        {laMainEstAuxAgents ? (
          <button
            type="button"
            disabled={enCours}
            onClick={() => soumettre(toutMettreEnValidation)}
            className="w-full rounded border border-alerte/50 bg-alerte/10 px-2 py-1.5 text-xs text-alerte transition hover:bg-alerte/20 disabled:opacity-50"
          >
            Reprendre la main
          </button>
        ) : (
          <button
            type="button"
            disabled={enCours}
            onClick={() => soumettre(confierLaMainAuxAgents)}
            className="w-full rounded bg-accent px-2 py-1.5 text-xs font-medium text-fond transition hover:opacity-90 disabled:opacity-50"
          >
            Laisser les agents trader seuls
          </button>
        )}
      </div>

      {retour ? (
        <p className="rounded border border-bordure bg-panneau-clair px-2 py-1 text-xs text-texte-attenue">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

function Cellule({
  libelle,
  valeur,
  classe,
}: {
  libelle: string;
  valeur: string;
  classe: string;
}) {
  return (
    <div className="rounded border border-bordure bg-panneau-clair px-3 py-2.5">
      <p className="text-xs leading-snug text-texte-attenue">{libelle}</p>
      <p className={`chiffre mt-1 text-base ${classe}`}>{valeur}</p>
    </div>
  );
}
