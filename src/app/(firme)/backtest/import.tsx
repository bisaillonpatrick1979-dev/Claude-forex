'use client';

import { useState } from 'react';

import { ecrireTrancheImportee } from '@/app/actions/import-historique';
import {
  analyserFichier,
  formatDepuisNom,
  intervalleDeduit,
  type ResultatImport,
} from '@/lib/marche/import-fichier';
import { INTERVALLES } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Import d'un historique depuis un fichier.
 *
 * Le fichier est lu et analysé **dans le navigateur**. Ce n'est pas une
 * commodité : quinze ans de M5 font plus d'un million de lignes, bien au-delà
 * de ce qu'une action serveur accepte d'un coup. On envoie donc des tranches
 * déjà validées.
 *
 * Deux temps, délibérément séparés : on analyse, on montre ce qui a été
 * compris — colonnes reconnues, période couverte, anomalies — et l'écriture
 * n'a lieu qu'après confirmation. Un import qui se trompe ne produit pas une
 * erreur visible mais un historique plausible et faux ; le relire avant d'écrire
 * est le seul moment où l'erreur est encore rattrapable.
 */

const TAILLE_TRANCHE = 2000;

export function ImportHistorique({ symboles }: { symboles: readonly string[] }) {
  const [symbole, setSymbole] = useState(symboles[0] ?? 'EURUSD');
  const [intervalle, setIntervalle] = useState<Intervalle>('D1');
  const [analyse, setAnalyse] = useState<ResultatImport | null>(null);
  const [nomFichier, setNomFichier] = useState<string | null>(null);
  const [progression, setProgression] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function choisirFichier(fichier: File) {
    setProgression(null);
    setNomFichier(fichier.name);
    const contenu = await fichier.text();
    const resultat = analyserFichier(contenu, formatDepuisNom(fichier.name, contenu));
    setAnalyse(resultat);

    // L'espacement médian des bougies désigne l'intervalle mieux que
    // l'utilisateur ne s'en souvient : on le propose, sans l'imposer.
    const pas = intervalleDeduit(resultat.chandeliers);
    const propose = pas === null ? null : INTERVALLES.find((code) => secondes(code) === pas);
    if (propose) setIntervalle(propose);
  }

  async function importer() {
    if (!analyse || analyse.bloquant) return;
    setEnCours(true);
    let ecrites = 0;

    try {
      for (let debut = 0; debut < analyse.chandeliers.length; debut += TAILLE_TRANCHE) {
        const tranche = analyse.chandeliers.slice(debut, debut + TAILLE_TRANCHE);
        const resultat = await ecrireTrancheImportee({ symbole, intervalle, bougies: tranche });

        if (!resultat.ok) {
          setProgression(`Interrompu à ${ecrites} bougie(s) : ${resultat.message}`);
          return;
        }
        ecrites += resultat.ecrites ?? 0;
        setProgression(`${ecrites} / ${analyse.chandeliers.length} bougies écrites…`);
      }
      setProgression(`Terminé : ${ecrites} bougies importées sur ${symbole} en ${intervalle}.`);
      setAnalyse(null);
    } finally {
      setEnCours(false);
    }
  }

  const periode = bornes(analyse);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Instrument</span>
          <select
            value={symbole}
            onChange={(evenement) => setSymbole(evenement.target.value)}
            className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-sm outline-none focus:border-accent"
          >
            {symboles.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Intervalle</span>
          <select
            value={intervalle}
            onChange={(evenement) => setIntervalle(evenement.target.value as Intervalle)}
            className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-sm outline-none focus:border-accent"
          >
            {INTERVALLES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Fichier CSV ou JSON</span>
          <input
            type="file"
            accept=".csv,.txt,.tsv,.json,text/csv,application/json"
            disabled={enCours}
            onChange={(evenement) => {
              const fichier = evenement.target.files?.[0];
              if (fichier) void choisirFichier(fichier);
            }}
            className="text-xs text-texte-attenue file:mr-2 file:rounded file:border file:border-bordure file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-texte"
          />
        </label>
      </div>

      {analyse ? (
        <div className="flex flex-col gap-2 rounded border border-bordure/60 p-2.5">
          <p className="text-xs text-texte-attenue">
            <span className="text-texte">{nomFichier}</span> — {analyse.chandeliers.length} bougie(s)
            lisible(s)
            {periode ? ` du ${periode.debut} au ${periode.fin}` : ''}.
          </p>

          {Object.keys(analyse.colonnes).length > 0 ? (
            <p className="text-[0.7rem] leading-relaxed text-texte-attenue">
              Colonnes reconnues :{' '}
              {Object.entries(analyse.colonnes)
                .map(([role, entete]) => `${role} ← « ${entete} »`)
                .join(', ')}
              . Vérifier cette lecture avant d’écrire : c’est le dernier moment où une erreur
              d’interprétation reste rattrapable.
            </p>
          ) : null}

          {analyse.anomalies.length > 0 ? (
            <ul
              className={`flex max-h-40 flex-col gap-0.5 overflow-auto rounded border px-2 py-1.5 text-[0.7rem] leading-relaxed ${
                analyse.bloquant
                  ? 'border-alerte/40 bg-alerte/10 text-alerte'
                  : 'border-bordure/60 text-texte-attenue'
              }`}
            >
              {analyse.anomalies.map((anomalie, index) => (
                <li key={index}>
                  {anomalie.ligne === null ? '' : `Ligne ${anomalie.ligne} : `}
                  {anomalie.message}
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            disabled={enCours || analyse.bloquant}
            onClick={() => void importer()}
            className="self-start rounded border border-accent bg-accent/10 px-3 py-1.5 text-sm text-texte disabled:border-bordure disabled:bg-transparent disabled:text-texte-attenue"
          >
            {enCours
              ? 'Écriture…'
              : analyse.bloquant
                ? 'Import bloqué — corriger le fichier'
                : `Importer ${analyse.chandeliers.length} bougies dans ${symbole} ${intervalle}`}
          </button>
        </div>
      ) : null}

      {progression ? (
        <p className="chiffre rounded border border-bordure/60 px-2 py-1.5 text-xs text-texte-attenue">
          {progression}
        </p>
      ) : null}

      <p className="text-[0.7rem] leading-relaxed text-texte-attenue">
        Les bougies importées portent la source « import » : ni simulées, ni rapportées par un
        fournisseur en ligne. Elles n’expirent pas — un historique ne se rafraîchit pas — et un
        second import du même intervalle remplace les bougies de même horodatage sans créer de
        doublon.
      </p>
    </div>
  );
}

function bornes(analyse: ResultatImport | null): { debut: string; fin: string } | null {
  if (!analyse || analyse.chandeliers.length === 0) return null;
  const premier = analyse.chandeliers[0]!.horodatage;
  const dernier = analyse.chandeliers[analyse.chandeliers.length - 1]!.horodatage;
  const jour = (secondesUtc: number) =>
    new Date(secondesUtc * 1000).toISOString().slice(0, 10);
  return { debut: jour(premier), fin: jour(dernier) };
}

/** Durée d'un intervalle, pour rapprocher l'espacement mesuré d'un code connu. */
function secondes(code: Intervalle): number {
  const table: Record<string, number> = {
    M1: 60,
    M5: 300,
    M15: 900,
    M30: 1800,
    H1: 3600,
    H4: 14_400,
    D1: 86_400,
    W1: 604_800,
  };
  return table[code] ?? 0;
}
