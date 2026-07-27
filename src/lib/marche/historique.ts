import { genererSerie } from './fournisseurs/mock';
import { debutBougie, dureeSecondes } from './intervalles';
import type { Chandelier, ClasseActif, Intervalle } from './types';

/**
 * Fenêtres d'historique profond, pour le rejeu.
 *
 * Une mise au point qui compte : personne ne sert quinze ans de bougies M1
 * gratuitement. Les paliers gratuits de Twelve Data et de Yahoo donnent
 * quelques mois en intraday et plusieurs années en journalier, pas davantage.
 * Deux sources sont donc proposées, et l'interface dit laquelle est active :
 *
 *  - SIMULE : série déterministe calculée localement, de profondeur illimitée.
 *    Elle ne rejoue pas le vrai marché — c'est un banc d'essai du moteur, des
 *    agents et des garde-fous, pas une preuve de performance passée.
 *  - FOURNISSEUR : vraies bougies, dans les limites du fournisseur. On ne
 *    complète jamais un trou avec de la donnée simulée ; un manque reste un
 *    manque.
 */

export type SourceRejeu = 'SIMULE' | 'FOURNISSEUR';

/** Profondeur réellement servie, par intervalle et par source. Les valeurs
 *  FOURNISSEUR sont volontairement prudentes : mieux vaut annoncer moins et
 *  tenir que promettre quinze ans et rendre trois mois. */
const PROFONDEUR_MAX_JOURS: Readonly<Record<Intervalle, number>> = {
  M1: 30,
  M5: 60,
  M15: 90,
  M30: 180,
  H1: 730,
  H4: 730,
  D1: 5_500,
  W1: 5_500,
};

export function profondeurMaximaleJours(
  intervalle: Intervalle,
  source: SourceRejeu,
): number {
  // La série simulée est calculée à partir de l'index absolu de la bougie :
  // aucune borne autre que celle de l'époque Unix.
  return source === 'SIMULE' ? 15 * 365 : PROFONDEUR_MAX_JOURS[intervalle];
}

export interface DemandeFenetre {
  readonly symbole: string;
  readonly classeActif: ClasseActif;
  readonly intervalle: Intervalle;
  /** Horodatage de fin, inclus. */
  readonly jusqua: number;
  readonly limite: number;
}

/**
 * Bougies simulées se terminant à un instant donné.
 *
 * `genererSerie` produit une série ancrée sur l'index absolu de chaque bougie :
 * demander la même fenêtre deux fois rend exactement les mêmes chiffres, et
 * deux fenêtres qui se chevauchent se recollent sans discontinuité. C'est ce
 * qui rend un rejeu reproductible.
 */
export function fenetreSimulee(demande: DemandeFenetre): readonly Chandelier[] {
  return genererSerie(
    {
      symbole: demande.symbole,
      classeActif: demande.classeActif,
      intervalle: demande.intervalle,
      limite: Math.max(1, Math.min(demande.limite, 5000)),
    },
    demande.jusqua,
  );
}

/** Bougies strictement postérieures au curseur, dans l'ordre chronologique. */
export function bougiesApres(
  chandeliers: readonly Chandelier[],
  curseur: number,
  maximum: number,
): readonly Chandelier[] {
  return chandeliers.filter((bougie) => bougie.horodatage > curseur).slice(0, maximum);
}

/** Instant de départ d'un rejeu, aligné sur une ouverture de bougie. */
export function departRejeu(
  intervalle: Intervalle,
  joursEnArriere: number,
  maintenant: number = Math.floor(Date.now() / 1000),
): number {
  return debutBougie(maintenant - joursEnArriere * 86_400, intervalle);
}

/** Nombre de bougies entre deux instants, pour afficher une progression. */
export function nombreBougies(
  debut: number,
  fin: number,
  intervalle: Intervalle,
): number {
  return Math.max(0, Math.floor((fin - debut) / dureeSecondes(intervalle)));
}
