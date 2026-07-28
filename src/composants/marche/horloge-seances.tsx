'use client';

import { useEffect, useState } from 'react';

import {
  SEANCES,
  etatSeances,
  type CodeSeance,
} from '@/lib/marche/seances-mondiales';

/**
 * Horloge des séances mondiales.
 *
 * C'est l'équivalent du bandeau que toutes les plateformes professionnelles
 * placent en haut de l'écran : quatre séances, celles qui sont ouvertes, et le
 * temps qui reste avant que ça change. Un trader ne lit pas une heure UTC, il
 * lit « Londres ferme dans 40 min ».
 *
 * ── Pourquoi le compte à rebours descend jusqu'au changement, pas jusqu'à une
 * heure fixe ─────────────────────────────────────────────────────────────────
 *
 * L'information utile n'est pas « il est 14 h 12 », c'est « dans 2 h 48,
 * Londres ferme et la liquidité tombe ». Le prochain changement est calculé
 * par balayage sur l'ensemble des séances ouvertes : ouverture *ou* fermeture,
 * puisque les deux modifient le régime du marché.
 *
 * ── Le rendu initial vient du serveur, l'animation du navigateur ────────────
 *
 * `instantInitial` est calculé côté serveur et passé en propriété. Sans lui,
 * le premier rendu client et le rendu serveur divergeraient d'une seconde et
 * React signalerait une erreur d'hydratation. On part donc de l'instant du
 * serveur, puis on prend la main.
 */

const COULEURS: Readonly<Record<CodeSeance, string>> = {
  SYDNEY: '#38bdf8',
  TOKYO: '#f472b6',
  LONDRES: '#34d399',
  NEW_YORK: '#fbbf24',
};

export function HorlogeSeances({ instantInitial }: { instantInitial: number }) {
  const [instant, setInstant] = useState(instantInitial);

  useEffect(() => {
    // Une fois par seconde : le compte à rebours doit descendre visiblement,
    // et le calcul est trivial — quatre comparaisons d'entiers.
    const minuterie = setInterval(() => setInstant(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(minuterie);
  }, []);

  const etat = etatSeances(instant);
  const restant = etat.prochainChangement === null ? null : etat.prochainChangement - instant;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {SEANCES.map((seance) => {
          const ouverte = etat.ouvertes.includes(seance.code);
          return (
            <span
              key={seance.code}
              title={`${seance.description} — ${formaterPlage(seance.ouvertureUtc, seance.fermetureUtc)} UTC`}
              className={[
                'chiffre flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.7rem] uppercase tracking-wider transition-colors',
                ouverte
                  ? 'border-bordure-vive text-texte'
                  : 'border-bordure text-texte-attenue/50',
              ].join(' ')}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${ouverte ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: ouverte ? COULEURS[seance.code] : 'transparent',
                         boxShadow: ouverte ? 'none' : 'inset 0 0 0 1px currentColor' }}
              />
              {seance.nom}
            </span>
          );
        })}
      </div>

      <p className="chiffre text-[0.7rem] text-texte-attenue">
        {etat.weekEnd ? (
          <span className="text-alerte">Marché fermé — réouverture de Sydney dimanche 21 h UTC.</span>
        ) : (
          <>
            {etat.chevauchement ? (
              // Le chevauchement est l'information la plus actionnable de la
              // journée : c'est là que les spreads se resserrent.
              <span className="text-hausse">{etat.chevauchement}</span>
            ) : etat.dominante ? (
              <span>Séance {nomCourt(etat.dominante)}</span>
            ) : (
              <span>Aucune séance ouverte</span>
            )}
            {restant !== null ? <> · change dans {formaterDuree(restant)}</> : null}
          </>
        )}
      </p>
    </div>
  );
}

function nomCourt(code: CodeSeance): string {
  return SEANCES.find((seance) => seance.code === code)?.nom ?? code;
}

function formaterPlage(ouverture: number, fermeture: number): string {
  const hhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${hhmm(ouverture)}–${hhmm(fermeture)}`;
}

/** « 2 h 48 » ou « 12 min » : on ne montre les secondes que dans la dernière
 *  minute, où elles sont la seule chose qui bouge. */
function formaterDuree(secondes: number): string {
  if (secondes <= 0) return 'un instant';
  const heures = Math.floor(secondes / 3600);
  const minutes = Math.floor((secondes % 3600) / 60);
  if (heures > 0) return `${heures} h ${String(minutes).padStart(2, '0')}`;
  if (minutes > 0) return `${minutes} min`;
  return `${secondes} s`;
}
