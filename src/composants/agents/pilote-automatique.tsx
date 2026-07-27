'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { instrumentsSurveilles, veiller } from '@/app/actions/cycles';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Pilote automatique : la firme travaille sans qu'on lui demande.
 *
 * Elle ne délibère pas en boucle pour autant. Un cycle n'est déclenché que
 * lorsqu'une bougie s'est fermée depuis le précédent : relancer une
 * délibération complète sur exactement les mêmes chiffres produirait exactement
 * la même conclusion, en la facturant une seconde fois. La vérification est
 * faite côté serveur, pas ici — un compteur de navigateur se remet à zéro à
 * chaque rechargement de page.
 *
 * Limite à dire franchement : cette boucle vit dans l'onglet. Fermez-le et la
 * veille s'arrête. Une veille qui survit à la fermeture du navigateur exige un
 * ordonnanceur côté serveur, que le palier gratuit de l'hébergeur ne fournit
 * pas au-delà d'un déclenchement quotidien. Le point d'entrée existe déjà
 * (`/api/veille`) pour le jour où ce sera possible.
 */

/** Fréquence à laquelle on demande au serveur s'il y a du nouveau. Ce n'est pas
 *  la fréquence des délibérations : celle-là est dictée par l'intervalle. */
const CADENCES: readonly { libelle: string; secondes: number }[] = [
  { libelle: '30 s', secondes: 30 },
  { libelle: '1 min', secondes: 60 },
  { libelle: '5 min', secondes: 300 },
];

export function PiloteAutomatique({
  symbole,
  intervalle,
}: {
  symbole: string;
  intervalle: Intervalle;
}) {
  const router = useRouter();
  const [actif, setActif] = useState(false);
  const [cadence, setCadence] = useState(1);
  const [etat, setEtat] = useState<string | null>(null);
  const [cycles, setCycles] = useState(0);
  const [dernierTour, setDernierTour] = useState<number | null>(null);
  const [instruments, setInstruments] = useState<readonly string[]>([]);
  const [surveilleTout, setSurveilleTout] = useState(true);

  // Références : la boucle ne doit pas se reconstruire à chaque changement de
  // cadence ou de symbole, sinon elle se dédouble.
  const actifRef = useRef(actif);
  actifRef.current = actif;
  const cadenceRef = useRef(cadence);
  cadenceRef.current = cadence;
  const contexteRef = useRef({ symbole, intervalle });
  contexteRef.current = { symbole, intervalle };
  const instrumentsRef = useRef<readonly string[]>([]);
  instrumentsRef.current = instruments;
  const toutRef = useRef(surveilleTout);
  toutRef.current = surveilleTout;

  // Périmètre autorisé, relu à l'ouverture : c'est lui qui décide sur quoi la
  // veille tourne, pas ce qui est affiché à l'écran.
  useEffect(() => {
    let annule = false;
    void instrumentsSurveilles().then((liste) => {
      if (!annule) setInstruments(liste.map((entree) => entree.code));
    });
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    if (!actif) return;
    let annule = false;

    // Rotation sur les instruments autorisés. Un tour complet par cadence
    // plutôt qu'un cycle sur tous d'un coup : quatre délibérations simultanées
    // dépasseraient le budget d'une seule et la durée d'une requête.
    let rang = 0;

    const boucle = async () => {
      while (!annule && actifRef.current) {
        const { symbole: affiche, intervalle: unite } = contexteRef.current;
        const liste = instrumentsRef.current;
        const surTout = toutRef.current && liste.length > 0;

        const instrument = surTout ? (liste[rang % liste.length] ?? affiche) : affiche;
        if (surTout) rang += 1;

        const resultat = await veiller(instrument, unite);

        if (annule) return;

        setEtat(`${instrument} — ${resultat.message}`);
        setDernierTour(Date.now());

        if (resultat.aTravaille) {
          setCycles((total) => total + 1);
          router.refresh();
        }

        // Un refus budgétaire arrête la veille : continuer produirait une
        // requête par minute pour le même refus jusqu'à demain.
        if (!resultat.ok && !resultat.aTravaille) {
          setActif(false);
          return;
        }

        const attente = (CADENCES[cadenceRef.current] ?? CADENCES[1]!).secondes * 1000;
        await new Promise((resoudre) => setTimeout(resoudre, attente));
      }
    };

    void boucle();
    return () => {
      annule = true;
    };
  }, [actif, router]);

  const basculer = useCallback(() => {
    setEtat(null);
    setActif((precedent) => !precedent);
  }, []);

  return (
    <div className="flex flex-col gap-2 border-t border-bordure pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={basculer}
          className={`flex-1 rounded px-3 py-2 text-xs font-medium transition ${
            actif
              ? 'border border-alerte/50 bg-alerte/10 text-alerte hover:bg-alerte/20'
              : 'bg-accent text-fond hover:opacity-90'
          }`}
        >
          {actif ? 'Arrêter la veille continue' : 'Veille continue'}
        </button>

        <select
          aria-label="Fréquence de vérification"
          value={cadence}
          onChange={(evenement) => setCadence(Number(evenement.target.value))}
          className="rounded border border-bordure bg-panneau-clair px-2 py-2 text-xs"
        >
          {CADENCES.map((option, index) => (
            <option key={option.libelle} value={index}>
              {option.libelle}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-xs text-texte-attenue">
        <input
          type="checkbox"
          checked={surveilleTout}
          onChange={(evenement) => setSurveilleTout(evenement.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        Surveiller tous les instruments autorisés
        {instruments.length > 0 ? ` (${instruments.length})` : ''}
        {!surveilleTout ? ` — seulement ${symbole}` : ''}
      </label>

      {actif ? (
        <p className="flex items-center gap-1.5 text-xs text-texte-attenue">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-hausse" />
          Les agents surveillent{' '}
          {surveilleTout && instruments.length > 0
            ? `${instruments.length} instrument(s)`
            : symbole}{' '}
          en {intervalle}, un à la fois par tour. Ils délibèrent à chaque nouvelle bougie fermée —
          au plus une fois par bougie, pour ne pas refacturer la même analyse.
        </p>
      ) : (
        <p className="text-xs text-texte-attenue">
          En veille continue, les agents analysent d’eux-mêmes à chaque bougie fermée. La boucle
          vit dans cet onglet : le fermer arrête la veille.
        </p>
      )}

      {etat ? (
        <p className="chiffre text-[0.72rem] text-texte-attenue/70">
          {cycles > 0 ? `${cycles} cycle(s) · ` : ''}
          {dernierTour ? `${new Date(dernierTour).toLocaleTimeString('fr-CA')} · ` : ''}
          {etat}
        </p>
      ) : null}
    </div>
  );
}
