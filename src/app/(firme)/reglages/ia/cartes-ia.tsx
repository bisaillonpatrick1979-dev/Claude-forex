'use client';

import { useState, useTransition } from 'react';

import {
  appliquerModeleATousLesAgents,
  enregistrerCleIa,
  supprimerCleIa,
  testerCleIa,
} from '@/app/actions/cles-ia';
import { Panneau } from '@/composants/ui/panneau';

/**
 * Une carte par fournisseur de modèles : sa clé, son état, ses modèles.
 *
 * La valeur en clair ne revient jamais du serveur — seul un indice visuel de
 * quatre caractères permet de reconnaître quelle clé est en place. Le champ de
 * saisie est vidé dès l'envoi : une clé qui traîne dans un formulaire finit
 * dans un gestionnaire de mots de passe, une capture d'écran ou un
 * remplissage automatique.
 */

export interface LigneFournisseurIa {
  readonly code: string;
  readonly nom: string;
  readonly necessiteCle: boolean;
  readonly modeles: readonly string[];
  readonly indiceVisuel: string | null;
  readonly enregistreeLe: string | null;
  readonly agentsUtilisant: number;
  readonly tarifs: readonly { modele: string; entree: number; sortie: number }[];
}

export function CartesIa({ fournisseurs }: { fournisseurs: readonly LigneFournisseurIa[] }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {fournisseurs.map((ligne) => (
        <CarteIa key={ligne.code} ligne={ligne} />
      ))}
    </div>
  );
}

function CarteIa({ ligne }: { ligne: LigneFournisseurIa }) {
  const [valeur, setValeur] = useState('');
  const [modele, setModele] = useState(ligne.modeles[0] ?? '');
  const [retour, setRetour] = useState<{ ok: boolean; message: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const lancer = (action: () => Promise<{ ok: boolean; message: string }>) => {
    setRetour(null);
    demarrer(async () => setRetour(await action()));
  };

  const cleEnPlace = ligne.indiceVisuel !== null;

  return (
    <Panneau
      titre={ligne.nom}
      action={
        <span
          className={`chiffre text-[0.72rem] uppercase tracking-wider ${
            !ligne.necessiteCle
              ? 'text-texte-attenue'
              : cleEnPlace
                ? 'text-hausse'
                : 'text-alerte'
          }`}
        >
          {!ligne.necessiteCle ? 'sans clé' : cleEnPlace ? 'clé en place' : 'clé absente'}
        </span>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {ligne.necessiteCle ? (
          <>
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                autoComplete="off"
                placeholder={cleEnPlace ? `Remplacer ${ligne.indiceVisuel}` : 'Coller la clé API'}
                value={valeur}
                onChange={(evenement) => setValeur(evenement.target.value)}
                className="chiffre min-w-0 flex-1 rounded border border-bordure bg-panneau-clair px-2.5 py-2 text-sm"
              />
              <button
                type="button"
                disabled={enCours || valeur.trim().length < 8}
                onClick={() =>
                  lancer(async () => {
                    const resultat = await enregistrerCleIa(ligne.code, valeur);
                    // Vidé dans tous les cas : une clé refusée n'a pas plus
                    // vocation à rester à l'écran qu'une clé acceptée.
                    setValeur('');
                    return resultat;
                  })
                }
                className="rounded bg-accent px-3 py-2 text-xs font-medium text-fond transition hover:opacity-90 disabled:opacity-40"
              >
                Enregistrer
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={enCours || !cleEnPlace}
                onClick={() => lancer(() => testerCleIa(ligne.code))}
                className="rounded border border-bordure-vive px-2.5 py-1.5 text-xs transition hover:border-accent disabled:opacity-40"
              >
                Tester la connexion
              </button>
              <button
                type="button"
                disabled={enCours || !cleEnPlace}
                onClick={() => lancer(() => supprimerCleIa(ligne.code))}
                className="rounded border border-bordure px-2.5 py-1.5 text-xs text-texte-attenue transition hover:border-baisse hover:text-baisse disabled:opacity-40"
              >
                Supprimer
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-texte-attenue">
            Simulation locale : aucune clé, aucun appel réseau, aucun coût. C’est le fournisseur
            par défaut des douze agents — la firme délibère de bout en bout sans rien dépenser.
          </p>
        )}

        <div className="rounded border border-bordure bg-panneau-clair p-2.5">
          <p className="mb-1.5 text-xs text-texte-attenue">
            Modèles connus et tarifés (dollars US par million de tokens)
          </p>
          <ul className="flex flex-col gap-1">
            {ligne.tarifs.map((tarif) => (
              <li key={tarif.modele} className="flex items-baseline justify-between gap-3">
                <span className="chiffre text-xs">{tarif.modele}</span>
                <span className="chiffre text-xs text-texte-attenue">
                  {tarif.entree} / {tarif.sortie}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-3">
          <select
            aria-label={`Modèle à appliquer pour ${ligne.nom}`}
            value={modele}
            onChange={(evenement) => setModele(evenement.target.value)}
            className="min-w-0 flex-1 rounded border border-bordure bg-panneau-clair px-2 py-1.5 text-xs"
          >
            {ligne.modeles.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={enCours}
            onClick={() => lancer(() => appliquerModeleATousLesAgents(ligne.code, modele))}
            className="rounded border border-bordure-vive px-2.5 py-1.5 text-xs transition hover:border-accent disabled:opacity-40"
          >
            Appliquer aux 12 agents
          </button>
        </div>

        <p className="chiffre text-[0.72rem] text-texte-attenue/70">
          {ligne.agentsUtilisant === 0
            ? 'Aucun agent n’utilise ce fournisseur.'
            : `${ligne.agentsUtilisant} agent(s) l’utilisent.`}
          {ligne.enregistreeLe
            ? ` · clé enregistrée le ${new Date(ligne.enregistreeLe).toLocaleDateString('fr-CA')}`
            : ''}
        </p>

        {retour ? (
          <p
            className={`rounded border px-2.5 py-1.5 text-xs ${
              retour.ok
                ? 'border-hausse/40 bg-hausse/10 text-hausse'
                : 'border-baisse/40 bg-baisse/10 text-baisse'
            }`}
          >
            {retour.message}
          </p>
        ) : null}
      </div>
    </Panneau>
  );
}
