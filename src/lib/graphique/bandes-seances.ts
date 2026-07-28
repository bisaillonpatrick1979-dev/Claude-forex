import { SEANCES, weekEndForex, type CodeSeance } from '@/lib/marche/seances-mondiales';
import { dureeSecondes } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Plages horaires des séances, à peindre sous les chandeliers.
 *
 * C'est la fonction que toutes les plateformes professionnelles proposent en
 * indicateur : des bandes verticales colorées qui disent, d'un coup d'œil, si
 * la bougie qu'on regarde a été formée par Tokyo ou par New York. Une mèche de
 * 30 pips ne veut pas dire la même chose à 3 h qu'à 14 h.
 *
 * ── Calcul pur, découpé jour par jour ───────────────────────────────────────
 *
 * On avance de jour UTC en jour UTC et, pour chaque séance, on pose sa plage
 * absolue. Une séance qui franchit minuit (Sydney, 21 h → 6 h) est posée sur
 * deux jours et se recolle naturellement, sans cas particulier à la jointure.
 *
 * ── Le week-end est retiré, pas masqué ──────────────────────────────────────
 *
 * Peindre une bande « Sydney » sur un samedi laisserait croire que le marché
 * cotait. Les portions de week-end sont donc découpées de la plage, quitte à
 * couper une séance en deux morceaux.
 */

export interface BandeSeance {
  readonly code: CodeSeance;
  /** Bornes en secondes UTC, `debut` inclus, `fin` exclu. */
  readonly debut: number;
  readonly fin: number;
}

const JOUR = 86_400;

/**
 * Au-delà de cet intervalle, une bougie couvre plusieurs séances : la bande
 * ne désignerait plus rien. Mieux vaut ne rien peindre qu'un repère faux.
 */
export const INTERVALLE_MAXIMUM_BANDES: Intervalle = 'H4';

export function bandesPertinentes(intervalle: Intervalle): boolean {
  return dureeSecondes(intervalle) <= dureeSecondes(INTERVALLE_MAXIMUM_BANDES);
}

/** Nombre de jours au-delà duquel on cesse de découper : à cette échelle les
 *  bandes se touchent et forment un aplat illisible. */
const JOURS_MAXIMUM = 40;

/**
 * Bandes couvrant `[debut, fin]`, une par séance et par jour, week-ends
 * retirés.
 *
 * Rend une liste vide quand la fenêtre est trop large : ce n'est pas un échec,
 * c'est le refus de peindre un repère qui ne se lirait plus.
 */
export function bandesSeances(debut: number, fin: number): readonly BandeSeance[] {
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return [];
  if (fin - debut > JOURS_MAXIMUM * JOUR) return [];

  const bandes: BandeSeance[] = [];
  // On démarre la veille du premier jour visible : une séance qui a commencé
  // hier soir déborde sur ce matin, et l'oublier laisserait un trou à gauche.
  const premierJour = Math.floor(debut / JOUR) * JOUR - JOUR;

  for (let jour = premierJour; jour <= fin; jour += JOUR) {
    for (const seance of SEANCES) {
      const ouverture = jour + seance.ouvertureUtc * 60;
      const fermeture =
        seance.fermetureUtc > seance.ouvertureUtc
          ? jour + seance.fermetureUtc * 60
          : jour + JOUR + seance.fermetureUtc * 60;

      const debutVisible = Math.max(ouverture, debut);
      const finVisible = Math.min(fermeture, fin);
      if (finVisible <= debutVisible) continue;

      bandes.push(...retirerWeekEnd(seance.code, debutVisible, finVisible));
    }
  }

  return bandes;
}

/**
 * Découpe une plage en morceaux hors week-end.
 *
 * Balayage à la demi-heure : les bornes du week-end tombent sur des heures
 * pleines, donc ce pas les capture exactement, et le code se relit sans avoir
 * à raisonner sur les fuseaux.
 */
function retirerWeekEnd(code: CodeSeance, debut: number, fin: number): readonly BandeSeance[] {
  const PAS = 1_800;
  const morceaux: BandeSeance[] = [];
  let ouvert: number | null = null;

  for (let instant = debut; instant < fin; instant += PAS) {
    const cote = !weekEndForex(instant);
    if (cote && ouvert === null) ouvert = instant;
    if (!cote && ouvert !== null) {
      morceaux.push({ code, debut: ouvert, fin: instant });
      ouvert = null;
    }
  }

  if (ouvert !== null) morceaux.push({ code, debut: ouvert, fin });
  return morceaux;
}

/**
 * Couleurs des bandes.
 *
 * Volontairement hors de la palette verte/rouge, réservée au P&L : une bande
 * de fond verte se lirait comme un gain. Ce sont des teintes froides et très
 * transparentes — un repère doit se voir sans concurrencer les chandeliers.
 */
export const COULEURS_BANDES: Readonly<Record<CodeSeance, string>> = {
  SYDNEY: 'rgba(56, 189, 248, 0.07)',
  TOKYO: 'rgba(244, 114, 182, 0.07)',
  LONDRES: 'rgba(148, 163, 184, 0.10)',
  NEW_YORK: 'rgba(251, 191, 36, 0.07)',
};
