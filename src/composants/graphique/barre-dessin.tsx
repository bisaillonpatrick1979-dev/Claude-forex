'use client';

import { useState, useTransition } from 'react';

import { renommerAnnotation, supprimerAnnotation } from '@/app/actions/annotations';
import {
  COULEURS_ANNOTATION,
  LIBELLES_OUTIL,
  OUTILS,
  type Annotation,
  type Outil,
} from '@/lib/graphique/annotations';

/**
 * Barre d'outils de dessin.
 *
 * Un point de conception qui n'est pas cosmétique : chaque annotation affiche
 * un champ de nom. Sur une plateforme classique le nom est décoratif — ici
 * c'est lui que les agents lisent. « Résistance hebdomadaire non cassée depuis
 * mars » vaut infiniment plus qu'un trait anonyme, parce que c'est la seule
 * partie du tracé qui porte le *pourquoi*.
 */

const ICONES: Readonly<Record<Outil, string>> = {
  NIVEAU: '─',
  TENDANCE: '╱',
  FIBONACCI: '≡',
  FIBONACCI_EXTENSION: '⇥',
  ZONE: '▭',
  NOTE: '✎',
};

export function BarreDessin({
  annotations,
  outil,
  couleur,
  surOutil,
  surCouleur,
  surChangement,
  decimales,
}: {
  annotations: readonly Annotation[];
  outil: Outil | null;
  couleur: string;
  surOutil: (outil: Outil | null) => void;
  surCouleur: (couleur: string) => void;
  surChangement: () => void;
  decimales: number;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [enCours, demarrer] = useTransition();
  const [edition, setEdition] = useState<{ id: string; texte: string } | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {OUTILS.map((code) => (
          <button
            key={code}
            type="button"
            title={LIBELLES_OUTIL[code]}
            aria-pressed={outil === code}
            onClick={() => surOutil(outil === code ? null : code)}
            className={[
              'rounded border px-1.5 py-0.5 text-sm leading-none transition-colors',
              outil === code
                ? 'border-accent bg-accent/15 text-texte'
                : 'border-bordure text-texte-attenue hover:text-texte',
            ].join(' ')}
          >
            {ICONES[code]}
          </button>
        ))}

        <span className="mx-0.5 h-4 w-px bg-bordure" />

        {COULEURS_ANNOTATION.map((option) => (
          <button
            key={option.code}
            type="button"
            title={option.nom}
            aria-pressed={couleur === option.code}
            onClick={() => surCouleur(option.code)}
            className={[
              'h-4 w-4 rounded-full border transition-transform',
              couleur === option.code ? 'scale-110 border-texte' : 'border-transparent',
            ].join(' ')}
            style={{ backgroundColor: option.code }}
          />
        ))}

        {annotations.length > 0 ? (
          <button
            type="button"
            onClick={() => setOuvert((precedent) => !precedent)}
            className="ml-auto rounded border border-bordure px-1.5 py-0.5 text-[0.72rem] uppercase tracking-wider text-texte-attenue transition-colors hover:text-texte"
          >
            {annotations.length} tracé{annotations.length > 1 ? 's' : ''}
          </button>
        ) : null}
      </div>

      {ouvert && annotations.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-bordure/60 p-1.5">
          {annotations.map((annotation) => (
            <li key={annotation.id} className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: annotation.couleur }}
              />
              <span className="shrink-0 text-texte-attenue">{ICONES[annotation.outil]}</span>
              <span className="chiffre shrink-0 text-texte-attenue">
                {annotation.points
                  .map((point) => point.prix.toFixed(decimales))
                  .join(' → ')}
              </span>

              {edition?.id === annotation.id ? (
                <input
                  autoFocus
                  value={edition.texte}
                  disabled={enCours}
                  placeholder="Pourquoi ce tracé ?"
                  onChange={(evenement) =>
                    setEdition({ id: annotation.id, texte: evenement.target.value })
                  }
                  onBlur={() => {
                    const texte = edition.texte;
                    setEdition(null);
                    demarrer(async () => {
                      await renommerAnnotation(annotation.id, texte);
                      surChangement();
                    });
                  }}
                  onKeyDown={(evenement) => {
                    if (evenement.key === 'Enter') evenement.currentTarget.blur();
                    if (evenement.key === 'Escape') setEdition(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-bordure bg-transparent px-1 py-0.5 text-xs outline-none focus:border-accent"
                />
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setEdition({ id: annotation.id, texte: annotation.libelle ?? '' })
                  }
                  className="min-w-0 flex-1 truncate text-left text-texte-attenue hover:text-texte"
                >
                  {annotation.libelle ?? <span className="italic opacity-60">nommer…</span>}
                </button>
              )}

              <button
                type="button"
                disabled={enCours}
                onClick={() =>
                  demarrer(async () => {
                    await supprimerAnnotation(annotation.id);
                    surChangement();
                  })
                }
                className="shrink-0 rounded px-1 text-texte-attenue transition-colors hover:text-alerte"
                title="Supprimer"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {ouvert && annotations.length > 0 ? (
        <p className="text-[0.68rem] leading-snug text-texte-attenue">
          Les tracés nommés sont remis aux agents dans leur instantané, comme hypothèses à
          confirmer ou à contredire. Un trait anonyme ne leur dit que sa géométrie.
        </p>
      ) : null}
    </div>
  );
}
