'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
  armerAlerte,
  desarmerAlerte,
  listerAlertes,
  listerEvenements,
  type AlerteAffichee,
  type EvenementAffiche,
} from '@/app/actions/alertes';
import { LIBELLES_DIRECTION, type Direction } from '@/lib/alertes/evaluation';
import { niveauxAnnotation, type Annotation } from '@/lib/graphique/annotations';

/**
 * Alertes de franchissement, armées depuis les niveaux déjà tracés.
 *
 * Le choix de conception : on n'arme pas une alerte en tapant un prix, on
 * l'arme sur un trait qu'on a posé. Saisir « 1.0920 » à la main, c'est
 * réinventer un niveau qu'on vient de dessiner, avec un risque de faute de
 * frappe et sans le nom qui portait le raisonnement. Partir du tracé garde le
 * lien — le message de franchissement pourra dire « Résistance hebdo » au lieu
 * d'un nombre nu.
 *
 * Les Fibonacci portent sept niveaux : chacun est proposé séparément, parce
 * qu'on surveille rarement les sept, et que le 61,8 n'a pas le même statut que
 * le 23,6.
 */

interface NiveauArmable {
  readonly prix: number;
  readonly etiquette: string;
  readonly annotationId: string;
  readonly libelle: string | null;
}

export function PanneauAlertes({
  symbole,
  annotations,
  prixCourant,
  decimales,
}: {
  symbole: string;
  annotations: readonly Annotation[];
  prixCourant: number | null;
  decimales: number;
}) {
  const [alertes, setAlertes] = useState<readonly AlerteAffichee[]>([]);
  const [evenements, setEvenements] = useState<readonly EvenementAffiche[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [enCours, demarrer] = useTransition();
  const [retour, setRetour] = useState<string | null>(null);

  const recharger = useCallback(() => {
    void listerAlertes(symbole).then(setAlertes);
    void listerEvenements(10).then(setEvenements);
  }, [symbole]);

  useEffect(recharger, [recharger]);

  const armables = niveauxArmables(annotations, alertes, decimales);
  const actives = alertes.filter((alerte) => alerte.active);
  const franchis = evenements.length;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOuvert((precedent) => !precedent)}
        className="flex items-center gap-1.5 self-start rounded border border-bordure px-1.5 py-0.5 text-[0.72rem] uppercase tracking-wider text-texte-attenue transition-colors hover:text-texte"
      >
        Alertes {actives.length > 0 ? `· ${actives.length} armée${actives.length > 1 ? 's' : ''}` : ''}
        {franchis > 0 ? (
          <span className="rounded-full bg-accent px-1.5 text-[0.65rem] text-fond">{franchis}</span>
        ) : null}
      </button>

      {ouvert ? (
        <div className="flex flex-col gap-2 rounded border border-bordure/60 p-2">
          {franchis > 0 ? (
            <section>
              <p className="mb-1 text-[0.68rem] uppercase tracking-wider text-texte-attenue">
                Franchissements récents
              </p>
              <ul className="flex flex-col gap-0.5">
                {evenements.map((evenement) => (
                  <li
                    key={evenement.id}
                    className={`chiffre text-xs ${evenement.direction === 'haussier' ? 'text-hausse' : 'text-baisse'}`}
                  >
                    {evenement.direction === 'haussier' ? '↑' : '↓'} {evenement.symbole}{' '}
                    {evenement.libelleAnnotation ?? evenement.niveau.toFixed(decimales)} —{' '}
                    {evenement.prix.toFixed(decimales)}
                    <span className="ml-1 text-texte-attenue">
                      {new Date(evenement.declencheLe).toLocaleString('fr-CA', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {actives.length > 0 ? (
            <section>
              <p className="mb-1 text-[0.68rem] uppercase tracking-wider text-texte-attenue">
                Armées
              </p>
              <ul className="flex flex-col gap-0.5">
                {actives.map((alerte) => (
                  <li key={alerte.id} className="flex items-center gap-1.5 text-xs">
                    <span className="chiffre">{alerte.niveau.toFixed(decimales)}</span>
                    <span className="min-w-0 flex-1 truncate text-texte-attenue">
                      {alerte.libelleAnnotation ?? LIBELLES_DIRECTION[alerte.direction as Direction]}
                    </span>
                    <span className="chiffre shrink-0 text-[0.68rem] text-texte-attenue">
                      {alerte.derniereCote ?? 'en attente'}
                    </span>
                    <button
                      type="button"
                      disabled={enCours}
                      onClick={() =>
                        demarrer(async () => {
                          await desarmerAlerte(alerte.id);
                          recharger();
                        })
                      }
                      className="shrink-0 px-1 text-texte-attenue transition-colors hover:text-alerte"
                      title="Désarmer"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <p className="mb-1 text-[0.68rem] uppercase tracking-wider text-texte-attenue">
              Armer sur un niveau tracé
            </p>
            {armables.length === 0 ? (
              <p className="text-xs text-texte-attenue">
                Aucun niveau disponible. Trace un niveau, une zone ou un Fibonacci : chacun de
                leurs prix devient armable ici.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {armables.map((niveau) => (
                  <button
                    key={`${niveau.annotationId}-${niveau.prix}`}
                    type="button"
                    disabled={enCours || prixCourant === null}
                    onClick={() =>
                      demarrer(async () => {
                        const resultat = await armerAlerte({
                          symbole,
                          niveau: niveau.prix,
                          // Un niveau au-dessus du cours ne s'observe qu'à la
                          // hausse : proposer l'inverse produirait une alerte
                          // qui ne peut jamais sonner.
                          direction:
                            prixCourant !== null && niveau.prix > prixCourant
                              ? 'haussier'
                              : 'baissier',
                          annotationId: niveau.annotationId,
                          libelleAnnotation: niveau.libelle,
                        });
                        setRetour(resultat.message ?? null);
                        recharger();
                      })
                    }
                    className="chiffre rounded border border-bordure px-1.5 py-0.5 text-xs text-texte-attenue transition-colors hover:border-accent hover:text-texte disabled:opacity-40"
                    title={niveau.libelle ?? undefined}
                  >
                    {niveau.etiquette}
                  </button>
                ))}
              </div>
            )}
          </section>

          {retour ? <p className="text-[0.68rem] text-texte-attenue">{retour}</p> : null}

          <p className="text-[0.68rem] leading-snug text-texte-attenue">
            La surveillance tourne côté serveur, toutes les cinq minutes — elle ne dépend pas de
            cet onglet. Un franchissement est aussi remis aux agents à leur prochaine
            délibération.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Niveaux qu'on peut encore armer.
 *
 * Les prix déjà surveillés sont retirés : proposer deux fois le même niveau
 * produirait deux alertes jumelles qui sonneraient ensemble. La comparaison se
 * fait sur le prix arrondi à l'affichage, parce que deux tracés distincts posés
 * au même endroit sont, pour ce qui nous occupe, le même niveau.
 */
function niveauxArmables(
  annotations: readonly Annotation[],
  alertes: readonly AlerteAffichee[],
  decimales: number,
): NiveauArmable[] {
  const dejaArmes = new Set(
    alertes.filter((alerte) => alerte.active).map((alerte) => alerte.niveau.toFixed(decimales)),
  );

  const resultat: NiveauArmable[] = [];
  const vus = new Set<string>();

  for (const annotation of annotations) {
    for (const niveau of niveauxAnnotation(annotation)) {
      const cle = niveau.prix.toFixed(decimales);
      if (dejaArmes.has(cle) || vus.has(cle)) continue;
      vus.add(cle);

      resultat.push({
        prix: niveau.prix,
        etiquette: niveau.libelle ? `${niveau.libelle} ${cle}` : cle,
        annotationId: annotation.id,
        libelle: annotation.libelle,
      });
    }
  }

  return resultat;
}
