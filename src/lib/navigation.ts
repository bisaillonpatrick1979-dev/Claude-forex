/** Structure de navigation de l'application. Source unique pour la barre
 *  latérale, la barre mobile et les titres de page. */
export interface EntreeNavigation {
  readonly href: string;
  readonly libelle: string;
  readonly abrege: string;
  readonly description: string;
}

export const NAVIGATION: readonly EntreeNavigation[] = [
  {
    href: '/salle-des-marches',
    libelle: 'Salle des marchés',
    abrege: 'Salle',
    description: 'Graphique, fil des spécialistes et état de la firme.',
  },
  {
    href: '/historique',
    libelle: 'Historique des cycles',
    abrege: 'Cycles',
    description: 'Tous les cycles de décision passés, rejouables message par message.',
  },
  {
    href: '/performance',
    libelle: 'Journal de performance',
    abrege: 'Perf.',
    description: 'Trades réalisés, courbe d’équité et métriques mesurées.',
  },
  {
    href: '/backtest',
    libelle: 'Backtest',
    abrege: 'Test',
    description: 'Rejeu historique sur le même moteur d’exécution que le papier.',
  },
  {
    href: '/agents',
    libelle: 'Agents',
    abrege: 'Agents',
    description: 'Organigramme de la firme et édition des mandats.',
  },
  {
    href: '/couts',
    libelle: 'Coûts',
    abrege: 'Coûts',
    description: 'Dépense LLM par jour et par agent, plafond quotidien.',
  },
  {
    href: '/reglages',
    libelle: 'Réglages',
    abrege: 'Réglages',
    description: 'Fournisseurs de données, clés API, modèles LLM, limites de risque.',
  },
] as const;

export function entreePour(chemin: string): EntreeNavigation | undefined {
  return NAVIGATION.find((entree) => chemin.startsWith(entree.href));
}
