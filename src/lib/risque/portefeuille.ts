import type { Sens } from '@/lib/execution/types';

/**
 * Risque de portefeuille, corrélations comprises.
 *
 * Ce que remplace ce module : une **somme naïve**. Le garde-fou additionnait le
 * risque de chaque position et comparait le total au budget.
 *
 * Cette somme n'est pas dangereuse au sens où elle laisserait passer trop —
 * par inégalité triangulaire elle majore toujours le risque réel. Son défaut
 * est qu'elle **ne distingue rien** : elle facture exactement le même montant
 * à une couverture parfaite et à un pari doublé.
 *
 *  - Long EUR/USD et short EUR/USD de même taille comptent pour deux unités de
 *    risque alors que le risque réel est nul. Le système refuse alors des
 *    positions qui ne coûtent rien, voire qui réduisent le risque.
 *  - Long EUR/USD et long NAS100, décorrélés, comptent aussi pour deux unités
 *    alors que le risque agrégé vaut √2. On bride un portefeuille diversifié
 *    comme s'il était concentré.
 *  - Et elle ne dit jamais **quelle** position porte le risque, ce qui est
 *    précisément la question à poser avant d'en ajouter une.
 *
 * Le vrai trou de sécurité était ailleurs : le compteur de positions
 * corrélées, qui comptait pour zéro trois positions à 0,69 sous un seuil réglé
 * à 0,70. Il a été remplacé — voir `concentration.ts`, qui s'appuie sur les
 * contributions marginales calculées ici.
 *
 * La formule correcte est celle du risque d'un portefeuille : on signe chaque
 * exposition par son sens, et on agrège par la matrice de corrélation.
 *
 *     σ = √( Σᵢ Σⱼ wᵢ wⱼ ρᵢⱼ )
 *
 * avec wᵢ le montant à risque, positif à l'achat et négatif à la vente, et ρ la
 * corrélation **des instruments**, indépendante du sens. Deux longs
 * parfaitement corrélés donnent 2w — additif. Un long et un short parfaitement
 * corrélés donnent 0 — couverture parfaite. C'est exactement ce qu'on veut.
 *
 * On en tire aussi la **contribution marginale** de chaque position, qui répond
 * à la question que le compteur ne pouvait pas poser : laquelle de mes
 * positions porte réellement le risque ?
 */

export interface PositionRisquee {
  readonly instrument: string;
  readonly sens: Sens;
  /** Montant à risque si le stop est touché, devise du compte, positif. */
  readonly risque: number;
}

/** Corrélation entre deux instruments, sens exclu, dans [-1, 1]. */
export type SourceCorrelation = (a: string, b: string) => number;

export interface ContributionRisque {
  readonly instrument: string;
  readonly sens: Sens;
  readonly risqueIsole: number;
  /** Part du risque agrégé imputable à cette position. Peut être négative
   *  quand la position couvre le reste du portefeuille. */
  readonly contribution: number;
  readonly partPct: number;
}

export interface RisqueAgrege {
  /** Somme naïve des risques : ce que calculait l'ancien garde-fou. */
  readonly risqueSomme: number;
  /** Risque réel du portefeuille, corrélations comprises. */
  readonly risqueEffectif: number;
  /**
   * Effectif ÷ somme. 1 = aucune diversification, les positions sont le même
   * pari. Proche de 0 = elles se couvrent. Au-dessus de 1, c'est impossible.
   */
  readonly ratioDiversification: number;
  readonly contributions: readonly ContributionRisque[];
}

export function risqueAgrege(
  positions: readonly PositionRisquee[],
  correlation: SourceCorrelation,
): RisqueAgrege {
  const risqueSomme = positions.reduce((total, position) => total + Math.abs(position.risque), 0);

  if (positions.length === 0 || risqueSomme === 0) {
    return { risqueSomme, risqueEffectif: 0, ratioDiversification: 0, contributions: [] };
  }

  const poids = positions.map(signer);

  // (R·w)ᵢ : covariance de la position i avec l'ensemble du portefeuille.
  const produits = poids.map((_, i) =>
    poids.reduce((total, poidsJ, j) => total + poidsJ * rho(correlation, positions, i, j), 0),
  );

  const variance = poids.reduce((total, poidsI, i) => total + poidsI * produits[i]!, 0);
  // La variance ne peut être négative qu'au bruit d'arrondi près, ou si la
  // matrice fournie n'est pas définie positive — on ne propage pas un NaN.
  const risqueEffectif = Math.sqrt(Math.max(0, variance));

  const contributions: ContributionRisque[] = positions.map((position, i) => {
    const contribution = risqueEffectif > 0 ? (poids[i]! * produits[i]!) / risqueEffectif : 0;
    return {
      instrument: position.instrument,
      sens: position.sens,
      risqueIsole: Math.abs(position.risque),
      contribution,
      partPct: risqueEffectif > 0 ? (contribution / risqueEffectif) * 100 : 0,
    };
  });

  return {
    risqueSomme,
    risqueEffectif,
    ratioDiversification: risqueSomme > 0 ? risqueEffectif / risqueSomme : 0,
    contributions,
  };
}

export interface DecisionBudget {
  /** Quantité de risque admissible pour la position proposée, en devise. */
  readonly risqueAutorise: number;
  readonly risqueActuel: number;
  readonly budget: number;
  /** Risque agrégé si la position est prise au montant autorisé. */
  readonly risqueApres: number;
  readonly refuse: boolean;
  readonly explication: string;
}

/**
 * Combien de risque la position proposée peut-elle encore prendre ?
 *
 * On résout exactement plutôt que d'itérer. Le risque agrégé après ajout d'une
 * position de risque `q` s'écrit
 *
 *     σ(q) = √( a·q² + 2b·q + c )
 *
 * où `a` est la variance propre de la nouvelle position (ρ = 1 avec elle-même),
 * `b` sa covariance avec le portefeuille existant, et `c` la variance actuelle.
 * Poser σ(q) = budget donne une équation du second degré dont la racine
 * positive est la réponse.
 *
 * L'intérêt de résoudre plutôt que de plafonner : quand `b` est franchement
 * négatif — la position couvre le portefeuille — la racine est grande, et le
 * système autorise davantage. Une somme naïve refuserait. C'est le cas que le
 * compteur ne pouvait pas voir.
 */
export function evaluerBudgetRisque(
  ouvertes: readonly PositionRisquee[],
  proposee: Omit<PositionRisquee, 'risque'>,
  budget: number,
  correlation: SourceCorrelation,
): DecisionBudget {
  const actuel = risqueAgrege(ouvertes, correlation);

  if (!(budget > 0)) {
    return {
      risqueAutorise: 0,
      risqueActuel: actuel.risqueEffectif,
      budget,
      risqueApres: actuel.risqueEffectif,
      refuse: true,
      explication: 'Aucun budget de risque : aucune ouverture possible.',
    };
  }

  if (actuel.risqueEffectif >= budget) {
    return {
      risqueAutorise: 0,
      risqueActuel: actuel.risqueEffectif,
      budget,
      risqueApres: actuel.risqueEffectif,
      refuse: true,
      explication:
        `Budget de risque déjà consommé : ${actuel.risqueEffectif.toFixed(2)} engagés sur ${budget.toFixed(2)}. ` +
        (actuel.ratioDiversification > 0.9
          ? 'Les positions ouvertes sont presque le même pari — la diversification n’apporte rien ici.'
          : ''),
    };
  }

  const signeNouvelle = proposee.sens === 'ACHAT' ? 1 : -1;
  const poidsOuvertes = ouvertes.map(signer);

  // Covariance unitaire de la nouvelle position avec chaque position ouverte.
  const b = poidsOuvertes.reduce(
    (total, poids, j) =>
      total + poids * signeNouvelle * correlation(proposee.instrument, ouvertes[j]!.instrument),
    0,
  );
  const c = actuel.risqueEffectif ** 2;
  const a = 1; // ρ d'une position avec elle-même

  const discriminant = b * b - a * (c - budget * budget);
  if (discriminant < 0) {
    return {
      risqueAutorise: 0,
      risqueActuel: actuel.risqueEffectif,
      budget,
      risqueApres: actuel.risqueEffectif,
      refuse: true,
      explication: 'Aucune taille ne respecte le budget : la position aggrave le risque existant.',
    };
  }

  const racine = (-b + Math.sqrt(discriminant)) / a;
  const risqueAutorise = Math.max(0, racine);

  const risqueApres = Math.sqrt(
    Math.max(0, c + 2 * b * risqueAutorise + risqueAutorise * risqueAutorise),
  );

  return {
    risqueAutorise,
    risqueActuel: actuel.risqueEffectif,
    budget,
    risqueApres,
    refuse: risqueAutorise <= 0,
    explication: rediger(actuel, risqueAutorise, b, budget),
  };
}

function rediger(
  actuel: RisqueAgrege,
  risqueAutorise: number,
  covariance: number,
  budget: number,
): string {
  if (risqueAutorise <= 0) {
    return `Budget saturé : ${actuel.risqueEffectif.toFixed(2)} sur ${budget.toFixed(2)}.`;
  }

  const morceaux: string[] = [];

  if (covariance < 0) {
    morceaux.push(
      'Cette position couvre partiellement le portefeuille : elle réduit le risque agrégé plutôt que de l’ajouter, ' +
        'et le budget disponible est donc supérieur à ce qu’une somme naïve laisserait croire.',
    );
  } else if (actuel.ratioDiversification > 0.9 && actuel.contributions.length > 1) {
    morceaux.push(
      `Les positions ouvertes sont fortement corrélées (${Math.round(actuel.ratioDiversification * 100)} % du risque brut subsiste après diversification) : ` +
        'ajouter dans le même sens revient à doubler le pari.',
    );
  }

  const dominante = [...actuel.contributions].sort((a, b) => b.contribution - a.contribution)[0];
  if (dominante && dominante.partPct > 60) {
    morceaux.push(
      `${dominante.instrument} porte à lui seul ${Math.round(dominante.partPct)} % du risque du portefeuille.`,
    );
  }

  return morceaux.join(' ');
}

function signer(position: PositionRisquee): number {
  return Math.abs(position.risque) * (position.sens === 'ACHAT' ? 1 : -1);
}

function rho(
  correlation: SourceCorrelation,
  positions: readonly PositionRisquee[],
  i: number,
  j: number,
): number {
  if (i === j) return 1;
  const valeur = correlation(positions[i]!.instrument, positions[j]!.instrument);
  return Number.isFinite(valeur) ? Math.max(-1, Math.min(1, valeur)) : 0;
}
