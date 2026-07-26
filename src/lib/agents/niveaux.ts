import type { Database } from '@/types/base-de-donnees';

export type NiveauAutonomie = Database['public']['Enums']['niveau_autonomie'];
export type RoleAgent = Database['public']['Enums']['role_agent'];

/**
 * Rôles habilités à faire exécuter un ordre.
 *
 * Doit rester synchronisé avec le trigger `verifier_niveau_autonomie` en base :
 * l'UI empêche de demander l'autonomie pour les autres rôles, la base la refuse
 * quand même. Le doublon est volontaire — l'un est ergonomique, l'autre est la
 * garantie.
 */
export const ROLES_EXECUTANTS: readonly RoleAgent[] = ['TRADER', 'GESTIONNAIRE_PORTEFEUILLE'];

export function roleHabiliteAExecuter(role: RoleAgent): boolean {
  return ROLES_EXECUTANTS.includes(role);
}

interface DescriptionNiveau {
  readonly code: NiveauAutonomie;
  readonly libelle: string;
  readonly description: string;
}

/** Libellés affichés dans l'UI. Source unique, comme pour les modes. */
export const DESCRIPTIONS_NIVEAUX: Readonly<Record<NiveauAutonomie, DescriptionNiveau>> = {
  OBSERVATEUR: {
    code: 'OBSERVATEUR',
    libelle: 'Observateur',
    description: 'Analyse et débat seulement. Ne touche jamais au portefeuille.',
  },
  PROPOSITION: {
    code: 'PROPOSITION',
    libelle: 'Proposition',
    description: 'Propose des ordres ; rien ne part sans votre validation.',
  },
  AUTONOME: {
    code: 'AUTONOME',
    libelle: 'Autonome',
    description: 'Exécute seul, dans ses limites et celles du portefeuille.',
  },
};

export const LIBELLES_ROLES: Readonly<Record<RoleAgent, string>> = {
  ANALYSTE_TECHNIQUE: 'Analyse technique',
  ANALYSTE_MACRO: 'Macro / Forex',
  ANALYSTE_FONDAMENTAL: 'Fondamental',
  ANALYSTE_SENTIMENT: 'Sentiment & nouvelles',
  ANALYSTE_VOLATILITE: 'Volatilité & liquidité',
  CHERCHEUR_HAUSSIER: 'Thèse haussière',
  CHERCHEUR_BAISSIER: 'Thèse baissière',
  DIRECTEUR_RECHERCHE: 'Arbitrage du débat',
  TRADER: 'Construction de l’ordre',
  GESTIONNAIRE_RISQUE: 'Veto de risque',
  GESTIONNAIRE_PORTEFEUILLE: 'Décision finale',
  AGENT_REFLEXION: 'Post-mortem et leçons',
};
