'use client';

import dynamique from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { creerAnnotation, listerAnnotations } from '@/app/actions/annotations';
import {
  annotationVisible,
  COULEUR_DEFAUT,
  type Annotation,
  type Outil,
  type PointGraphique,
} from '@/lib/graphique/annotations';
import { atr, derniereValeur, clotures, rsi } from '@/lib/marche/indicateurs';
import { INTERVALLES } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';

import { BarreDessin } from './barre-dessin';
import { INDICATEURS_DEFAUT, type IndicateursActifs, type MarqueurDecision } from './types-graphique';
import { useChandeliers } from './use-chandeliers';

/**
 * lightweight-charts manipule le DOM dès sa construction : le composant est
 * chargé sans rendu serveur. L'espace réservé garde la même hauteur, donc
 * aucun saut de mise en page au moment où le graphique arrive.
 */
const GraphiqueChandeliers = dynamique(
  () => import('./graphique-chandeliers').then((module) => module.GraphiqueChandeliers),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-xs text-texte-attenue">
        Chargement du graphique…
      </div>
    ),
  },
);

export interface SymboleOption {
  readonly code: string;
  readonly libelle: string;
  readonly classeActif: string;
  readonly decimales: number;
}

const BASCULES: readonly { cle: keyof IndicateursActifs; libelle: string }[] = [
  { cle: 'sma20', libelle: 'SMA 20' },
  { cle: 'sma50', libelle: 'SMA 50' },
  { cle: 'ema20', libelle: 'EMA 20' },
  { cle: 'rsi', libelle: 'RSI 14' },
];

export function ZoneGraphique({
  symboles,
  symboleInitial = 'EURUSD',
  intervalleInitial = 'M5',
  marqueurs = [],
  symboleControle,
  intervalleControle,
  surSymbole,
  surIntervalle,
  surDernierPrix,
}: {
  symboles: readonly SymboleOption[];
  symboleInitial?: string;
  intervalleInitial?: Intervalle;
  marqueurs?: readonly MarqueurDecision[];
  /** Mode contrôlé : la salle des marchés partage le couple symbole/intervalle
   *  entre le graphique et le billet d'ordre. */
  symboleControle?: string;
  intervalleControle?: Intervalle;
  surSymbole?: (symbole: string) => void;
  surIntervalle?: (intervalle: Intervalle) => void;
  surDernierPrix?: (prix: number | null) => void;
}) {
  const [symboleInterne, setSymboleInterne] = useState(symboleInitial);
  const [intervalleInterne, setIntervalleInterne] = useState<Intervalle>(intervalleInitial);
  const [indicateurs, setIndicateurs] = useState<IndicateursActifs>(INDICATEURS_DEFAUT);
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [outil, setOutil] = useState<Outil | null>(null);
  const [couleur, setCouleur] = useState(COULEUR_DEFAUT);

  const symbole = symboleControle ?? symboleInterne;
  const intervalle = intervalleControle ?? intervalleInterne;
  const setSymbole = surSymbole ?? setSymboleInterne;
  const setIntervalle = surIntervalle ?? setIntervalleInterne;

  const etat = useChandeliers(symbole, intervalle);
  const decimales = symboles.find((option) => option.code === symbole)?.decimales ?? 5;

  const rechargerAnnotations = useCallback(() => {
    void listerAnnotations(symbole).then(setAnnotations);
  }, [symbole]);

  useEffect(rechargerAnnotations, [rechargerAnnotations]);

  // Une annotation liée à une unité de temps ne se montre que sur celle-ci ;
  // une annotation sans unité suit l'instrument partout. Le filtre est fait
  // ici pour que le rendu et la liste affichée disent exactement la même chose.
  const visibles = useMemo(
    () => annotations.filter((annotation) => annotationVisible(annotation, symbole, intervalle)),
    [annotations, symbole, intervalle],
  );

  const tracer = useCallback(
    (points: readonly PointGraphique[]) => {
      if (!outil) return;
      void creerAnnotation({
        symbole,
        // Les niveaux et les zones valent sur toutes les unités de temps : un
        // support ne dépend pas de la loupe avec laquelle on le regarde. Les
        // tracés dépendants du temps, eux, restent sur leur unité.
        intervalle: outil === 'NIVEAU' || outil === 'ZONE' ? null : intervalle,
        outil,
        points,
        couleur,
        libelle: null,
      }).then((resultat) => {
        if (resultat.ok) rechargerAnnotations();
      });
      setOutil(null);
    },
    [outil, symbole, intervalle, couleur, rechargerAnnotations],
  );

  const mesures = useMemo(() => {
    if (etat.chandeliers.length === 0) return { rsi: null, atr: null, dernier: null };
    return {
      rsi: derniereValeur(rsi(clotures(etat.chandeliers), 14)),
      atr: derniereValeur(atr(etat.chandeliers, 14)),
      dernier: etat.chandeliers[etat.chandeliers.length - 1]?.cloture ?? null,
    };
  }, [etat.chandeliers]);

  // Le dernier prix remonte au parent : les positions ouvertes affichent leur
  // P&L latent avec la même valeur que celle lue sur le graphique.
  useEffect(() => {
    surDernierPrix?.(mesures.dernier);
  }, [mesures.dernier, surDernierPrix]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barre d'outils — enroulable sur tablette et mobile */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-bordure px-2 py-1.5">
        <select
          value={symbole}
          onChange={(evenement) => setSymbole(evenement.target.value)}
          aria-label="Symbole"
          className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent"
        >
          {symboles.map((option) => (
            <option key={option.code} value={option.code}>
              {option.code}
            </option>
          ))}
        </select>

        <div className="flex rounded border border-bordure bg-fond p-0.5">
          {INTERVALLES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setIntervalle(code)}
              className={[
                'chiffre rounded px-1.5 py-0.5 text-xs transition-colors',
                code === intervalle ? 'bg-panneau-clair text-texte' : 'text-texte-attenue hover:text-texte',
              ].join(' ')}
            >
              {code}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {BASCULES.map(({ cle, libelle }) => (
            <button
              key={cle}
              type="button"
              aria-pressed={indicateurs[cle]}
              onClick={() =>
                setIndicateurs((precedent) => ({ ...precedent, [cle]: !precedent[cle] }))
              }
              className={[
                'chiffre rounded border px-1.5 py-0.5 text-[0.72rem] uppercase tracking-wider transition-colors',
                indicateurs[cle]
                  ? 'border-bordure-vive text-texte'
                  : 'border-bordure text-texte-attenue hover:text-texte',
              ].join(' ')}
            >
              {libelle}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {mesures.dernier !== null ? (
            <span className="chiffre text-xs">{mesures.dernier.toFixed(decimales)}</span>
          ) : null}
          {mesures.rsi !== null ? (
            <span className="chiffre text-xs text-texte-attenue">
              RSI {mesures.rsi.toFixed(1)}
            </span>
          ) : null}
          {mesures.atr !== null ? (
            <span className="chiffre text-xs text-texte-attenue">
              ATR {mesures.atr.toFixed(decimales)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={etat.rafraichir}
            disabled={etat.chargement}
            title="Ignore le cache et force un appel fournisseur"
            className="rounded border border-bordure px-1.5 py-0.5 text-[0.72rem] uppercase tracking-wider text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
          >
            {etat.chargement ? '…' : 'Actualiser'}
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-bordure px-2 py-1.5">
        <BarreDessin
          annotations={visibles}
          outil={outil}
          couleur={couleur}
          surOutil={setOutil}
          surCouleur={setCouleur}
          surChangement={rechargerAnnotations}
          decimales={decimales}
        />
      </div>

      {/* Le graphique occupe tout l'espace restant */}
      <div className="min-h-48 flex-1">
        {etat.chandeliers.length > 0 ? (
          <GraphiqueChandeliers
            chandeliers={etat.chandeliers}
            decimales={decimales}
            indicateurs={indicateurs}
            marqueurs={marqueurs}
            cleInstrument={`${symbole}|${intervalle}`}
            annotations={visibles}
            outil={outil}
            couleurOutil={couleur}
            surTracer={tracer}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-texte-attenue">
            {etat.chargement
              ? 'Récupération des chandeliers…'
              : (etat.erreur ?? 'Aucune donnée pour cet instrument.')}
          </div>
        )}
      </div>

      {/* Provenance des données — jamais masquée */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-bordure px-2 py-1 text-xs">
        {etat.perime ? (
          <span className="chiffre rounded border border-alerte/50 bg-alerte/10 px-1.5 py-0.5 uppercase tracking-wider text-alerte">
            Données périmées
          </span>
        ) : null}
        <span className="chiffre text-texte-attenue">
          {etat.fournisseur ?? '—'}
          {etat.origine ? ` · ${etat.origine.toLowerCase().replace('_', ' ')}` : ''}
          {etat.retarde ? ' · retardées' : ''}
        </span>
        {etat.recupereLe !== null ? (
          <span className="chiffre text-texte-attenue">
            màj {new Date(etat.recupereLe * 1000).toLocaleTimeString('fr-CA')}
          </span>
        ) : null}
        {etat.erreur && etat.chandeliers.length > 0 ? (
          <span className="chiffre text-baisse">{etat.erreur}</span>
        ) : null}
        {etat.incidents.length > 0 ? (
          <span className="chiffre text-texte-attenue/70">
            {etat.incidents.map((incident) => incident.fournisseur).join(', ')} écarté
            {etat.incidents.length > 1 ? 's' : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}
