'use client';

import { useState, useTransition } from 'react';

import {
  basculerFournisseur,
  definirPriorite,
  enregistrerCleFournisseur,
  supprimerCleFournisseur,
  testerFournisseur,
} from '@/app/actions/fournisseurs';
import { Panneau } from '@/composants/ui/panneau';

export interface LigneFournisseur {
  readonly code: string;
  readonly nom: string;
  readonly actif: boolean;
  readonly implemente: boolean;
  readonly necessiteCle: boolean;
  readonly intervalles: readonly string[];
  readonly indiceVisuel: string | null;
  readonly quotaLimite: number | null;
  readonly quotaUtilise: number;
  readonly fenetre: string;
  readonly dernierStatut: string | null;
  readonly derniereErreur: string | null;
  readonly derniereVerification: string | null;
  readonly priorites: Readonly<Record<string, number>>;
}

const CLASSES = ['FOREX', 'INDICE', 'ACTION', 'CRYPTO', 'MATIERE_PREMIERE'] as const;

const ABREGE_CLASSE: Readonly<Record<string, string>> = {
  FOREX: 'FX',
  INDICE: 'IDX',
  ACTION: 'ACT',
  CRYPTO: 'CRY',
  MATIERE_PREMIERE: 'MP',
};

export function TableauFournisseurs({
  fournisseurs,
}: {
  fournisseurs: readonly LigneFournisseur[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {fournisseurs.map((ligne) => (
        <CarteFournisseur key={ligne.code} ligne={ligne} />
      ))}
      <p className="text-xs leading-relaxed text-texte-attenue">
        Priorité 1 = essayé en premier pour cette classe d’actifs ; vide = fournisseur non
        éligible. Le routeur écarte de lui-même un fournisseur dont le quota est épuisé, dont la
        clé manque, ou qui ne publie pas l’intervalle demandé.
      </p>
    </div>
  );
}

function CarteFournisseur({ ligne }: { ligne: LigneFournisseur }) {
  const [cleSaisie, setCleSaisie] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  function executer(action: () => Promise<{ ok: boolean; message: string }>) {
    demarrer(async () => {
      const resultat = await action();
      setMessage({ ok: resultat.ok, texte: resultat.message });
    });
  }

  const quota =
    ligne.quotaLimite === null
      ? 'illimité'
      : `${ligne.quotaUtilise} / ${ligne.quotaLimite} par ${ligne.fenetre.toLowerCase()}`;

  return (
    <Panneau>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-40">
          <div className="flex items-center gap-2">
            <span className="text-sm">{ligne.nom}</span>
            <span className="chiffre text-xs text-texte-attenue">{ligne.code}</span>
          </div>
          <p className="chiffre mt-0.5 text-xs text-texte-attenue">
            {ligne.implemente
              ? `${ligne.intervalles.join(' ')} · quota ${quota}`
              : 'adaptateur non livré'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Etat ligne={ligne} />
          <button
            type="button"
            disabled={enCours || !ligne.implemente}
            onClick={() => executer(() => testerFournisseur(ligne.code))}
            className="rounded border border-bordure px-2 py-1 text-xs text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
          >
            Tester
          </button>
          <button
            type="button"
            disabled={enCours || !ligne.implemente}
            onClick={() => executer(() => basculerFournisseur(ligne.code, !ligne.actif))}
            className="rounded border border-bordure px-2 py-1 text-xs text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
          >
            {ligne.actif ? 'Désactiver' : 'Activer'}
          </button>
        </div>
      </div>

      {ligne.necessiteCle ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={cleSaisie}
            onChange={(evenement) => setCleSaisie(evenement.target.value)}
            placeholder={ligne.indiceVisuel ?? 'Coller la clé API'}
            autoComplete="off"
            className="chiffre min-w-48 flex-1 rounded border border-bordure bg-fond px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={enCours || cleSaisie.length === 0}
            onClick={() =>
              executer(async () => {
                const resultat = await enregistrerCleFournisseur(ligne.code, cleSaisie);
                if (resultat.ok) setCleSaisie('');
                return resultat;
              })
            }
            className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-fond disabled:opacity-40"
          >
            Enregistrer
          </button>
          {ligne.indiceVisuel ? (
            <button
              type="button"
              disabled={enCours}
              onClick={() => executer(() => supprimerCleFournisseur(ligne.code))}
              className="text-xs text-texte-attenue underline-offset-4 hover:underline disabled:opacity-40"
            >
              Retirer
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {CLASSES.map((classe) => (
          <label key={classe} className="flex items-center gap-1.5">
            <span className="chiffre text-[0.72rem] uppercase tracking-wider text-texte-attenue">
              {ABREGE_CLASSE[classe]}
            </span>
            <input
              type="number"
              min={1}
              max={9}
              defaultValue={ligne.priorites[classe] ?? ''}
              disabled={enCours || !ligne.implemente}
              onBlur={(evenement) => {
                const brut = evenement.target.value.trim();
                const valeur = brut === '' ? null : Number.parseInt(brut, 10);
                const actuelle = ligne.priorites[classe] ?? null;
                if (valeur === actuelle) return;
                executer(() => definirPriorite(ligne.code, classe, valeur));
              }}
              className="chiffre w-11 rounded border border-bordure bg-fond px-1.5 py-1 text-center text-xs outline-none focus:border-accent disabled:opacity-40"
            />
          </label>
        ))}
      </div>

      {message ? (
        <p
          className={`mt-2 text-xs ${message.ok ? 'text-texte-attenue' : 'text-baisse'}`}
          role={message.ok ? undefined : 'alert'}
        >
          {message.texte}
        </p>
      ) : null}

      {ligne.derniereErreur ? (
        <p className="chiffre mt-2 text-xs text-baisse">
          Dernière erreur : {ligne.derniereErreur}
        </p>
      ) : null}
    </Panneau>
  );
}

function Etat({ ligne }: { ligne: LigneFournisseur }) {
  const epuise = ligne.quotaLimite !== null && ligne.quotaUtilise >= ligne.quotaLimite;

  const [texte, classe] = !ligne.implemente
    ? ['non livré', 'text-texte-attenue']
    : !ligne.actif
      ? ['inactif', 'text-texte-attenue']
      : epuise
        ? ['quota épuisé', 'text-alerte']
        : ligne.dernierStatut === 'ERREUR'
          ? ['en erreur', 'text-baisse']
          : ligne.dernierStatut === 'OK'
            ? ['connecté', 'text-texte']
            : ['actif, jamais testé', 'text-texte-attenue'];

  return (
    <span className={`chiffre text-xs uppercase tracking-wider ${classe}`}>{texte}</span>
  );
}
