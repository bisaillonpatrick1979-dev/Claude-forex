import type { EtatPortefeuille } from '@/lib/execution/types';

import type { InstantaneMarche } from './instantane';

/**
 * Construction des invites.
 *
 * Le mandat de l'agent vient de la base (`mandats_agents`), modifiable par le
 * propriétaire de la firme. Ce fichier n'ajoute que ce que l'utilisateur ne
 * doit pas pouvoir supprimer par inadvertance : les règles maison, le format
 * de sortie attendu, et le rappel qu'aucun chiffre ne s'invente.
 *
 * Rien ici ne fait office de limite de risque. Les plafonds sont appliqués par
 * `evaluerGardeFous`, côté serveur, après l'agent. Une consigne dans un prompt
 * se contourne ; un `if` en TypeScript, non.
 */

const REGLES_MAISON = [
  'Règles de la firme, non négociables :',
  '- Tu ne cites aucun chiffre absent du contexte qui t’est fourni. Si une donnée manque, écris « donnée manquante ».',
  '- Tu ne promets jamais de gain. Tu décris des scénarios et leurs conditions d’invalidation.',
  '- « Ne rien faire » est une conclusion valide et souvent la bonne.',
  '- Sois bref. Dix lignes utiles valent mieux que quarante lignes de prudence.',
].join('\n');

export interface ContexteFirme {
  readonly mandat: string;
  readonly nomAgent: string;
  readonly modeOperation: string;
  readonly strategies: readonly string[];
  readonly lecons: readonly string[];
  /** Consigne de recherche web, quand le rôle y a droit. */
  readonly consigneRecherche?: string | null;
}

const FORMATS: Readonly<Record<string, string>> = {
  vue_marche: `Termine par un bloc \`\`\`json contenant exactement :
{"direction":"HAUSSIER|BAISSIER|NEUTRE","conviction":0-100,"horizon":"texte court","niveau_invalidation":nombre ou null,"resume":"deux phrases"}`,

  proposition: `Termine par un bloc \`\`\`json contenant soit :
{"action":"ABSTENTION","raisonnement":"pourquoi"}
soit :
{"action":"ORDRE","sens":"ACHAT|VENTE","type_ordre":"MARCHE|LIMITE|STOP","quantite":nombre de lots,"prix_entree":nombre ou null,"stop_loss":nombre,"take_profit":nombre ou null,"validite_minutes":entier ou null,"raisonnement":"pourquoi"}
Le stop-loss est obligatoire : une proposition sans stop est rejetée par le serveur.
Les niveaux doivent provenir de l’instantané ; un prix hors de son amplitude est rejeté automatiquement.`,

  decision_pm: `Termine par un bloc \`\`\`json contenant exactement :
{"decision":"APPROUVE|REFUSE","justification":"une à trois phrases"}`,

  lecon: `Termine par un bloc \`\`\`json contenant exactement :
{"titre":"court","contenu":"leçon réutilisable","etiquettes":["mot","mot"]}`,
};

export function construireSysteme(
  contexte: ContexteFirme,
  formatJson?: string | null,
): string {
  const morceaux = [
    contexte.mandat.trim(),
    '',
    REGLES_MAISON,
    '',
    `Mode d’opération courant : ${contexte.modeOperation}. Le portefeuille est simulé ; aucun ordre réel n’est transmis à un courtier.`,
  ];

  if (contexte.strategies.length > 0) {
    morceaux.push(
      '',
      'PLAYBOOKS DE LA MAISON (extraits pertinents, à utiliser ou à écarter explicitement) :',
      ...contexte.strategies,
    );
  }

  if (contexte.lecons.length > 0) {
    morceaux.push(
      '',
      'LEÇONS TIRÉES DES POSITIONS PASSÉES DE CETTE FIRME :',
      ...contexte.lecons,
    );
  }

  if (contexte.consigneRecherche) {
    morceaux.push('', 'RECHERCHE WEB', contexte.consigneRecherche);
  }

  const format = formatJson ? FORMATS[formatJson] : undefined;
  if (format) morceaux.push('', 'FORMAT DE SORTIE', format);

  return morceaux.join('\n');
}

export function messagePortefeuille(
  portefeuille: EtatPortefeuille,
  nombrePositions: number,
  devise: string,
): string {
  return [
    'ÉTAT DU PORTEFEUILLE',
    `Devise : ${devise}`,
    `Solde : ${portefeuille.solde.toFixed(2)}`,
    `Équité : ${portefeuille.equite.toFixed(2)}`,
    `Marge utilisée : ${portefeuille.margeUtilisee.toFixed(2)}`,
    `Sommet d’équité : ${portefeuille.sommetEquite.toFixed(2)}`,
    `Positions ouvertes : ${nombrePositions}`,
    portefeuille.gele ? 'PORTEFEUILLE GELÉ : aucune ouverture possible.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Résumé d'un rapport pour les étapes suivantes. Le contexte de chaque agent
 *  est borné : on transmet des résumés, jamais l'intégralité du fil. */
export function resumerPourSuite(nom: string, contenu: string, limite = 1200): string {
  const texte = contenu.trim();
  const coupe = texte.length > limite ? `${texte.slice(0, limite)}…` : texte;
  return `— ${nom} —\n${coupe}`;
}

export function messageInstantane(instantane: InstantaneMarche, rendu: string): string {
  return `Symbole étudié : ${instantane.symbole} en ${instantane.intervalle}.\n\n${rendu}`;
}
