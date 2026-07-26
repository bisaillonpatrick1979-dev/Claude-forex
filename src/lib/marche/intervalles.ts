import type { Intervalle } from './types';

interface SpecIntervalle {
  /** Durée d'une bougie, en secondes. */
  readonly dureeSecondes: number;
  /**
   * Durée de vie du cache pour la bougie en cours de formation.
   * Une bougie déjà fermée n'est jamais redemandée, quel que soit ce TTL :
   * l'historique ne change pas.
   */
  readonly ttlSecondes: number;
}

export const SPECS_INTERVALLES: Readonly<Record<Intervalle, SpecIntervalle>> = {
  M1: { dureeSecondes: 60, ttlSecondes: 60 },
  M5: { dureeSecondes: 300, ttlSecondes: 60 },
  M15: { dureeSecondes: 900, ttlSecondes: 120 },
  M30: { dureeSecondes: 1800, ttlSecondes: 180 },
  H1: { dureeSecondes: 3600, ttlSecondes: 300 },
  H4: { dureeSecondes: 14400, ttlSecondes: 900 },
  D1: { dureeSecondes: 86400, ttlSecondes: 43200 },
  W1: { dureeSecondes: 604800, ttlSecondes: 86400 },
};

export const INTERVALLES: readonly Intervalle[] = Object.keys(SPECS_INTERVALLES) as Intervalle[];

export function estIntervalle(valeur: string): valeur is Intervalle {
  return valeur in SPECS_INTERVALLES;
}

export function dureeSecondes(intervalle: Intervalle): number {
  return SPECS_INTERVALLES[intervalle].dureeSecondes;
}

export function ttlSecondes(intervalle: Intervalle): number {
  return SPECS_INTERVALLES[intervalle].ttlSecondes;
}

/** Horodatage d'ouverture de la bougie contenant `instant` (secondes UTC). */
export function debutBougie(instant: number, intervalle: Intervalle): number {
  const duree = dureeSecondes(intervalle);
  // W1 : diviser brutalement depuis l'époque place le début de semaine un
  // jeudi (1970-01-01 était un jeudi). Décaler de 3 jours ramène les bornes
  // sur le lundi — le premier lundi de l'époque est le 5 janvier 1970.
  if (intervalle === 'W1') {
    const decalageLundi = 3 * 86400;
    return Math.floor((instant + decalageLundi) / duree) * duree - decalageLundi;
  }
  return Math.floor(instant / duree) * duree;
}

/** Vrai si la bougie ouverte à `horodatage` est close à `instant`. */
export function bougieFermee(horodatage: number, intervalle: Intervalle, instant: number): boolean {
  return horodatage + dureeSecondes(intervalle) <= instant;
}
