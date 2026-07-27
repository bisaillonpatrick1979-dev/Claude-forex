'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { arreterRejeu, avancerRejeu, demarrerRejeu } from '@/app/actions/replay';
import { reinitialiserFirme } from '@/app/actions/reinitialisation';
import { profondeurMaximaleJours, type SourceRejeu } from '@/lib/marche/historique';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Commande de rejeu : remonter le temps et faire défiler le marché.
 *
 * La cadence est pilotée ici, pas côté serveur : une horloge serveur exigerait
 * un processus survivant entre deux requêtes, ce qu'un hébergement sans
 * serveur ne fournit pas. Le navigateur demande « avance de N bougies » à
 * intervalle régulier ; chaque bougie passe par le moteur d'exécution réel.
 *
 * Le prochain appel n'est armé qu'au retour du précédent. Sans cela, un
 * serveur plus lent que la cadence verrait les demandes s'empiler jusqu'à la
 * limite de débit.
 */

export interface EtatRejeu {
  readonly actif: boolean;
  readonly symbole: string | null;
  readonly intervalle: Intervalle | null;
  readonly curseur: number | null;
  readonly debut: number | null;
  readonly fin: number | null;
  readonly source: string | null;
}

/**
 * Cadences proposées, exprimées en bougies traitées par seconde.
 *
 * Pas en « multiplicateur de temps » : un ×100 ne veut rien dire quand
 * l'intervalle change — cent fois plus vite sur du M1 et sur du D1, ce ne sont
 * pas les mêmes ordres de grandeur. En bougies par seconde, le chiffre garde
 * le même sens partout.
 *
 * `parAppel` est plafonné à 500 côté serveur : au-delà, la fonction dépasse la
 * durée maximale d'exécution et le lot entier est perdu. Pour aller plus vite,
 * on appelle plus souvent, pas plus gros.
 *
 * Repère concret en « Éclair » : environ 4 000 bougies par seconde, soit un an
 * de H1 (~6 200 bougies) en moins de deux secondes, ou quinze ans de D1
 * (~3 900 bougies) en une seconde.
 */
const VITESSES: readonly { libelle: string; detail: string; parSeconde: number; parAppel: number }[] = [
  { libelle: 'Pas à pas', detail: '1 bougie/s', parSeconde: 1, parAppel: 1 },
  { libelle: 'Lent', detail: '~10 bougies/s', parSeconde: 5, parAppel: 2 },
  { libelle: 'Rapide', detail: '~250 bougies/s', parSeconde: 5, parAppel: 50 },
  { libelle: 'Très rapide', detail: '~1 500 bougies/s', parSeconde: 6, parAppel: 250 },
  { libelle: 'Éclair', detail: '~4 000 bougies/s', parSeconde: 8, parAppel: 500 },
];

const PROFONDEURS: readonly { libelle: string; jours: number }[] = [
  { libelle: '1 mois', jours: 30 },
  { libelle: '1 an', jours: 365 },
  { libelle: '5 ans', jours: 5 * 365 },
  { libelle: '15 ans', jours: 15 * 365 },
];

function dateLisible(horodatage: number | null): string {
  return horodatage === null ? '—' : new Date(horodatage * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function CommandeRejeu({
  etat,
  symbole,
  intervalle,
  capitalInitial,
}: {
  etat: EtatRejeu;
  symbole: string;
  intervalle: Intervalle;
  capitalInitial: number;
}) {
  const router = useRouter();
  const [source, setSource] = useState<SourceRejeu>((etat.source as SourceRejeu) ?? 'SIMULE');
  const [jours, setJours] = useState(365);
  const [vitesse, setVitesse] = useState(2);
  const [enLecture, setEnLecture] = useState(false);
  const [retour, setRetour] = useState<string | null>(null);
  const [curseur, setCurseur] = useState<number | null>(etat.curseur);
  const [progression, setProgression] = useState<{ faites: number; total: number } | null>(null);
  const [enCours, demarrer] = useTransition();

  // Une référence plutôt qu'une dépendance d'effet : la boucle ne doit pas se
  // reconstruire à chaque tic, sinon elle se dédouble.
  const lectureRef = useRef(enLecture);
  lectureRef.current = enLecture;
  const vitesseRef = useRef(vitesse);
  vitesseRef.current = vitesse;

  const plafond = profondeurMaximaleJours(intervalle, source);

  useEffect(() => {
    if (!enLecture) return;
    let annule = false;

    const boucle = async () => {
      while (!annule && lectureRef.current) {
        const cadence = VITESSES[vitesseRef.current] ?? VITESSES[0]!;
        const resultat = await avancerRejeu(cadence.parAppel);

        if (annule) return;

        setCurseur(resultat.curseur);
        setProgression(resultat.progression);

        if (!resultat.ok || resultat.termine) {
          setRetour(resultat.message);
          setEnLecture(false);
          router.refresh();
          return;
        }

        // Le prochain appel n'est armé qu'ici : la cadence s'adapte d'elle-même
        // à un serveur lent au lieu d'empiler les requêtes.
        await new Promise((resoudre) => setTimeout(resoudre, 1000 / cadence.parSeconde));
      }
      router.refresh();
    };

    void boucle();
    return () => {
      annule = true;
    };
  }, [enLecture, router]);

  const ouvrir = useCallback(() => {
    setRetour(null);
    demarrer(async () => {
      const resultat = await demarrerRejeu({ symbole, intervalle, joursEnArriere: jours, source });
      setRetour(resultat.message);
      setCurseur(resultat.curseur);
      setProgression(resultat.progression);
      router.refresh();
    });
  }, [symbole, intervalle, jours, source, router]);

  const fermer = useCallback(() => {
    setEnLecture(false);
    demarrer(async () => {
      const resultat = await arreterRejeu();
      setRetour(resultat.message);
      router.refresh();
    });
  }, [router]);

  const choixPeriode = (
    <>
        <div className="flex gap-2">
          <select
            aria-label="Source des données"
            value={source}
            onChange={(evenement) => setSource(evenement.target.value as SourceRejeu)}
            className="min-w-0 flex-1 rounded border border-bordure bg-panneau-clair px-2 py-1 text-xs"
          >
            <option value="SIMULE">Données simulées</option>
            <option value="FOURNISSEUR">Données réelles</option>
          </select>
          <select
            aria-label="Profondeur"
            value={jours}
            onChange={(evenement) => setJours(Number(evenement.target.value))}
            className="min-w-0 flex-1 rounded border border-bordure bg-panneau-clair px-2 py-1 text-xs"
          >
            {PROFONDEURS.filter((option) => option.jours <= plafond).map((option) => (
              <option key={option.jours} value={option.jours}>
                {option.libelle}
              </option>
            ))}
          </select>
        </div>

        <p className="chiffre text-[0.72rem] leading-tight text-texte-attenue/70">
          {source === 'SIMULE'
            ? 'Série déterministe calculée localement : profondeur illimitée, mais ce n’est pas le vrai marché. Banc d’essai du moteur et des agents, pas une performance passée.'
            : `Vraies bougies, dans la limite du fournisseur : environ ${plafond} jours en ${intervalle}. Aucun trou n’est comblé par de la donnée inventée.`}
        </p>

        <button
          type="button"
          onClick={ouvrir}
          disabled={enCours}
          className="rounded border border-bordure-vive px-2 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
        >
          {etat.actif
            ? `Redémarrer sur ${symbole} — ${PROFONDEURS.find((o) => o.jours === jours)?.libelle ?? ''}`
            : `Rejouer ${symbole} en ${intervalle}`}
        </button>
    </>
  );

  if (!etat.actif) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        {choixPeriode}

        {retour ? (
          <p className="rounded border border-bordure bg-panneau-clair px-2 py-1 text-xs text-texte-attenue">
            {retour}
          </p>
        ) : null}
      </div>
    );
  }

  const pourcentage =
    progression && progression.total > 0
      ? Math.min(100, (progression.faites / progression.total) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="rounded border border-alerte/40 bg-alerte/10 px-2 py-1 text-xs text-alerte">
        Rejeu en cours sur {etat.symbole} — le portefeuille vit au{' '}
        {dateLisible(curseur ?? etat.curseur)} UTC, pas au présent.
      </p>

      <div className="h-1 w-full overflow-hidden rounded bg-panneau-clair">
        <div className="h-full bg-accent transition-all" style={{ width: `${pourcentage}%` }} />
      </div>
      <p className="chiffre text-[0.72rem] text-texte-attenue">
        {progression ? `${progression.faites} / ${progression.total} bougies` : '—'} · jusqu’au{' '}
        {dateLisible(etat.fin)}
      </p>

      <div>
        <p className="mb-1 text-xs text-texte-attenue">
          Vitesse de défilement — plus vite les bougies passent, plus vite les agents accumulent
          des positions fermées à débriefer.
        </p>
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
          {VITESSES.map((option, index) => (
            <button
              key={option.libelle}
              type="button"
              onClick={() => setVitesse(index)}
              title={option.detail}
              className={`rounded border px-1.5 py-1.5 text-xs leading-tight transition ${
                vitesse === index
                  ? 'border-accent text-accent'
                  : 'border-bordure text-texte-attenue hover:border-bordure-vive'
              }`}
            >
              {option.libelle}
            </button>
          ))}
        </div>
        <p className="chiffre mt-1 text-[0.72rem] text-texte-attenue/70">
          {VITESSES[vitesse]?.detail ?? ''}
        </p>
      </div>

      <details className="rounded border border-bordure bg-panneau-clair px-2 py-1.5">
        <summary className="cursor-pointer text-xs text-texte-attenue">
          Changer de période ou de source
        </summary>
        <div className="mt-2 flex flex-col gap-2">{choixPeriode}</div>
      </details>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEnLecture((actuel) => !actuel)}
          className="flex-1 rounded bg-accent px-2 py-1.5 text-xs font-medium text-fond transition hover:opacity-90"
        >
          {enLecture ? 'Pause' : 'Lecture'}
        </button>
        <button
          type="button"
          disabled={enLecture || enCours}
          onClick={() =>
            demarrer(async () => {
              const resultat = await avancerRejeu(1);
              setCurseur(resultat.curseur);
              setProgression(resultat.progression);
              setRetour(resultat.message);
              router.refresh();
            })
          }
          className="rounded border border-bordure-vive px-2 py-1.5 text-xs transition hover:border-accent disabled:opacity-50"
        >
          Pas à pas
        </button>
        <button
          type="button"
          onClick={fermer}
          className="rounded border border-bordure px-2 py-1.5 text-xs text-texte-attenue transition hover:border-baisse hover:text-baisse"
        >
          Arrêter
        </button>
      </div>

      <button
        type="button"
        disabled={enCours}
        onClick={() => {
          setEnLecture(false);
          demarrer(async () => {
            const resultat = await reinitialiserFirme({
              capital: capitalInitial,
              // Le point central : on efface la session, jamais ce que les
              // agents ont appris. C'est tout l'intérêt d'un rejeu de cinq ans.
              conserverLecons: true,
              effacerHistorique: true,
            });
            setRetour(resultat.message);
            setCurseur(null);
            setProgression(null);
            router.refresh();
          });
        }}
        className="rounded border border-baisse/40 px-2 py-1.5 text-xs text-baisse transition hover:bg-baisse/10 disabled:opacity-50"
      >
        Réinitialiser les données — les leçons des agents sont conservées
      </button>

      {retour ? (
        <p className="rounded border border-bordure bg-panneau-clair px-2 py-1 text-xs text-texte-attenue">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
