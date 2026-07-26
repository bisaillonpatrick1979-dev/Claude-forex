import type { ModeOperation } from './drapeaux';

interface DescriptionMode {
  readonly code: ModeOperation;
  readonly libelle: string;
  readonly description: string;
}

/** Libellés affichés dans l'UI. Source unique, pour éviter les divergences. */
export const DESCRIPTIONS_MODES: Readonly<Record<ModeOperation, DescriptionMode>> = {
  PAPIER_AUTONOME: {
    code: 'PAPIER_AUTONOME',
    libelle: 'Papier — autonome',
    description: 'Les agents tradent seuls sur un portefeuille simulé.',
  },
  PAPIER_VALIDATION: {
    code: 'PAPIER_VALIDATION',
    libelle: 'Papier — validation',
    description: 'Chaque ordre attend votre approbation avant exécution simulée.',
  },
  REEL_VALIDATION: {
    code: 'REEL_VALIDATION',
    libelle: 'Réel — validation',
    description: 'Broker réel, validation manuelle obligatoire. Verrouillé jusqu’à la phase 7.',
  },
};

/** Avertissement permanent, affiché sur toutes les pages. */
export const AVERTISSEMENT_RISQUE =
  'Résultats simulés. Le trading comporte un risque de perte totale du capital.';
