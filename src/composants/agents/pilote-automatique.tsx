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
 * Limite à dire franchement : cette boucle vit dans l'onglet. Le fermer
 * empêche le tour suivant — mais **n'interrompt pas** celui qui est déjà parti.
 * Une action serveur ne s'annule pas parce que le navigateur a raccroché : le
 * cycle en cours va jusqu'au bout, écrit ses lignes et facture ses appels. Une
 * dizaine d'appels, une minute environ. C'est normal, et c'est ce qu'on voit
 * quand on croit avoir tout arrêté.
 *
 * Le seul frein qui ne dépend d'aucun onglet est le kill switch : il est en
 * base, donc il vaut depuis n'importe quel appareil, y compris pour un onglet
 * resté ouvert ailleurs ou un ordonnanceur externe.
 *
 * Une veille qui survit à la fermeture du navigateur exige un ordonnanceur côté
 * serveur, que le palier gratuit de l'hébergeur ne fournit pas au-delà d'un
 * déclenchement quotidien. Le point d'entrée existe déjà (`/api/veille`).
 */

/** Fréquence à laquelle on demande au serveur s'il y a du nouveau. Ce n'est pas
 *  la fréquence des délibérations : celle-là est dictée par l'intervalle. */
const CADENCES: readonly { libelle: string; secondes: number }[] = [
  // « Illimité » n'est pas une boucle sans frein : le prochain appel part dès
  // le retour du précédent, et le serveur refuse toujours de délibérer deux
  // fois sur la même bougie. On enchaîne donc les vérifications, pas les
  // dépenses. Une seconde d'écart évite seulement de saturer le navigateur.
  { libelle: 'Illimité', secondes: 1 },
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
  const [cadence, setCadence] = useState(2);
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

        const attente = (CADENCES[cadenceRef.current] ?? CADENCES[2]!).secondes * 1000;
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

  const [replie, setReplie] = useState(true);

  return (
    // Compact par défaut. Ce panneau partage sa hauteur avec le fil des agents,
    // et c'est le fil qu'on vient lire : les réglages de la veille ne doivent
    // pas manger l'espace de ce qu'ils produisent. Une ligne d'état, un bouton,
    // et le reste replié — dépliable quand on veut vraiment y toucher.
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-bordure pt-2 text-sm">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={basculer}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
            actif
              ? 'border border-alerte/50 bg-alerte/10 text-alerte hover:bg-alerte/20'
              : 'bg-accent text-fond hover:opacity-90'
          }`}
        >
          {actif ? 'Arrêter la veille' : 'Veille continue'}
        </button>

        {actif ? (
          <span className="flex items-center gap-1 text-[0.7rem] text-texte-attenue">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-hausse" />
            {cycles > 0 ? `${cycles} cycle${cycles > 1 ? 's' : ''}` : 'en écoute'}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => setReplie((precedent) => !precedent)}
          title="Réglages de la veille"
          aria-expanded={!replie}
          className="rounded border border-bordure px-1.5 py-1 text-[0.7rem] text-texte-attenue transition-colors hover:text-texte"
        >
          {replie ? '⋯' : '×'}
        </button>
      </div>

      {/* L'état tient sur une ligne, tronqué. Le message complet reste
          accessible au survol : une erreur de cycle ne doit pas s'étaler sur
          quatre lignes au détriment des analyses. */}
      {etat ? (
        <p className="chiffre truncate text-[0.68rem] text-texte-attenue/70" title={etat}>
          {dernierTour ? `${new Date(dernierTour).toLocaleTimeString('fr-CA')} · ` : ''}
          {etat}
        </p>
      ) : null}

      {!replie ? (
        <div className="flex flex-col gap-1.5 rounded border border-bordure/60 p-2">
          <label className="flex items-center gap-2 text-[0.7rem] text-texte-attenue">
            <span className="shrink-0">Vérifier</span>
            <select
              aria-label="Fréquence de vérification"
              value={cadence}
              onChange={(evenement) => setCadence(Number(evenement.target.value))}
              className="rounded border border-bordure bg-panneau-clair px-1.5 py-1 text-[0.7rem]"
            >
              {CADENCES.map((option, index) => (
                <option key={option.libelle} value={index}>
                  {option.libelle}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-[0.7rem] text-texte-attenue">
            <input
              type="checkbox"
              checked={surveilleTout}
              onChange={(evenement) => setSurveilleTout(evenement.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Tous les instruments autorisés
            {instruments.length > 0 ? ` (${instruments.length})` : ''}
          </label>

          <p className="text-[0.68rem] leading-snug text-texte-attenue/80">
            Les agents délibèrent à chaque nouvelle bougie fermée, une seule fois par bougie —
            relancer la même analyse la referait payer. La boucle vit dans cet onglet ; le fermer
            empêche le tour suivant, sans interrompre le cycle déjà parti.
          </p>
        </div>
      ) : null}
    </div>
  );
}
