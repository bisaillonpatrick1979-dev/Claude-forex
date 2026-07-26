import type { Database } from '@/types/base-de-donnees';

export type ModeOperation = Database['public']['Enums']['mode_operation'];

/**
 * Verrou du mode réel.
 *
 * Trois barrières indépendantes, à lever ensemble en phase 7 :
 *   1. cette constante, en dur dans le bundle serveur ;
 *   2. la variable d'environnement AUTORISER_MODE_REEL ;
 *   3. un trigger PostgreSQL qui refuse tout mode commençant par REEL.
 *
 * Un `if` oublié quelque part ne suffit donc jamais à envoyer un ordre réel.
 */
const VERROU_PHASE_7 = true as const;

/** Modes réellement sélectionnables aujourd'hui. */
export const MODES_AUTORISES: readonly ModeOperation[] = ['PAPIER_AUTONOME', 'PAPIER_VALIDATION'];

export function modeReelAutorise(): boolean {
  if (VERROU_PHASE_7) return false;
  return process.env.AUTORISER_MODE_REEL === 'true';
}

export function modeAutorise(mode: ModeOperation): boolean {
  if (mode === 'REEL_VALIDATION') return modeReelAutorise();
  return MODES_AUTORISES.includes(mode);
}

/**
 * Garde à appeler avant toute opération sensible au mode. Lève plutôt que de
 * renvoyer un booléen : un appelant ne doit pas pouvoir ignorer le refus.
 */
export function exigerModeAutorise(mode: ModeOperation): void {
  if (!modeAutorise(mode)) {
    throw new Error(
      `Mode « ${mode} » indisponible : le trading réel est verrouillé jusqu'à la phase 7.`,
    );
  }
}
