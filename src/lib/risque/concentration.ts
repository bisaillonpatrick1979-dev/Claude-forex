import type { ClasseActif } from '@/lib/marche/types';

import { risqueAgrege, type PositionRisquee, type SourceCorrelation } from './portefeuille';

/**
 * Contrainte de concentration : quelle part du risque une seule position, ou un
 * seul facteur, a le droit de porter.
 *
 * Ce module remplace un compteur. L'ancien garde-fou comptait les positions
 * ouvertes dont la corrélation avec la position proposée dépassait un seuil, et
 * refusait au-delà de deux. Deux défauts, tous deux exploitables :
 *
 *  - **Effet de falaise.** Trois positions à 0,69 sous un seuil réglé à 0,70
 *    comptaient pour zéro position corrélée. Trois fois le même pari, approuvé
 *    sans réserve. Un dixième de corrélation en plus, et tout était refusé.
 *  - **Aveuglement aux chaînes.** Le compteur ne regardait que les paires. Long
 *    EUR/USD, long GBP/USD et short USD/CHF n'ont pas de couple au-dessus du
 *    seuil, mais forment un seul pari : short USD, en triple.
 *
 * On remplace donc le comptage par deux mesures continues, toutes deux
 * résolues exactement plutôt qu'itérées.
 *
 * **1. Part du risque agrégé portée par une position.** La contribution
 * marginale d'une position au risque du portefeuille, divisée par ce risque.
 * Les parts somment à 100 % par construction (théorème d'Euler sur σ, qui est
 * homogène de degré 1). Plafonner cette part interdit qu'une position devienne
 * le portefeuille à elle seule.
 *
 * **2. Exposition nette par facteur.** On décompose chaque position en
 * expositions signées à des facteurs — les devises pour le Forex, la classe
 * d'actif sinon. Long EUR/USD, c'est long EUR et short USD. Les expositions se
 * compensent ou s'additionnent, et un plafond sur le net attrape exactement la
 * chaîne que le compteur ne voyait pas.
 *
 * Le nombre de paris effectifs, `(Σ risques / σ)²`, est publié comme
 * diagnostic. Il vaut n pour n positions indépendantes de même taille, et 1
 * pour n positions parfaitement corrélées. Trois positions à 0,69 en donnent
 * 1,26 : le chiffre que le compteur affichait comme « 0 position corrélée ».
 *
 * À noter : la part par position ne se mesure **pas** par un indice de
 * Herfindahl sur les contributions. Trois positions de même taille et de même
 * corrélation ont, par symétrie, exactement un tiers du risque chacune, quelle
 * que soit cette corrélation — un Herfindahl y verrait trois paris là où il n'y
 * en a qu'un. C'est le ratio de diversification, pas la répartition des
 * contributions, qui porte l'information de corrélation.
 */

/** Métadonnées minimales pour décomposer un instrument en facteurs. */
export interface InstrumentFacteurs {
  readonly code: string;
  readonly classeActif: ClasseActif;
  readonly deviseBase: string | null;
  readonly deviseCotation: string;
}

export interface PoidsFacteur {
  readonly facteur: string;
  /** Poids signé pour une position **à l'achat**. Le sens est appliqué après. */
  readonly poids: number;
}

/** Facteurs touchés par un instrument, poids signés pour un achat. */
export type SourceFacteurs = (instrument: string) => readonly PoidsFacteur[];

/**
 * Décomposition d'un instrument en facteurs de risque.
 *
 * Forex et matières premières cotées en devise : acheter EUR/USD, c'est long
 * EUR et short USD ; acheter XAU/USD, c'est long l'or et short USD. Les deux
 * jambes portent le même poids, ce qui est l'hypothèse standard et suffit à
 * faire apparaître les concentrations de devise.
 *
 * Le reste tombe sur sa classe d'actif. C'est grossier — NAS100 et SPX500
 * deviennent le même facteur — mais dans le bon sens : ces deux-là *sont*
 * essentiellement le même pari, et les traiter comme distincts est l'erreur
 * qu'on cherche à éliminer.
 */
export function facteursInstrument(instrument: InstrumentFacteurs): readonly PoidsFacteur[] {
  const parDevises =
    instrument.classeActif === 'FOREX' || instrument.classeActif === 'MATIERE_PREMIERE';

  if (parDevises && instrument.deviseBase) {
    if (instrument.deviseBase === instrument.deviseCotation) return [];
    return [
      { facteur: instrument.deviseBase, poids: 1 },
      { facteur: instrument.deviseCotation, poids: -1 },
    ];
  }

  return [{ facteur: instrument.classeActif, poids: 1 }];
}

/** Construit une source de facteurs à partir d'une liste d'instruments connus. */
export function sourceFacteurs(instruments: readonly InstrumentFacteurs[]): SourceFacteurs {
  const table = new Map(instruments.map((instrument) => [instrument.code, instrument]));
  return (code) => {
    const instrument = table.get(code);
    return instrument ? facteursInstrument(instrument) : [];
  };
}

export interface ExpositionFacteur {
  readonly facteur: string;
  /** Somme signée des risques exposés à ce facteur, devise du compte. */
  readonly expositionNette: number;
  /** Somme des valeurs absolues : ce que le net masque quand il se compense. */
  readonly expositionBrute: number;
}

export interface AnalyseConcentration {
  readonly risqueSomme: number;
  readonly risqueEffectif: number;
  /** `(Σ risques / σ)²` : n pour n paris indépendants, 1 pour n fois le même. */
  readonly parisEffectifs: number;
  /** Part du risque agrégé portée par la position la plus lourde, en %. */
  readonly partPositionMaxPct: number;
  readonly positionDominante: string | null;
  /** Facteurs triés par exposition nette absolue décroissante. */
  readonly facteurs: readonly ExpositionFacteur[];
}

export function analyserConcentration(
  positions: readonly PositionRisquee[],
  correlation: SourceCorrelation,
  facteurs: SourceFacteurs,
): AnalyseConcentration {
  const agrege = risqueAgrege(positions, correlation);

  const dominante = [...agrege.contributions].sort((a, b) => b.partPct - a.partPct)[0];

  return {
    risqueSomme: agrege.risqueSomme,
    risqueEffectif: agrege.risqueEffectif,
    // Un portefeuille couvert fait tendre σ vers zéro et le nombre de paris
    // vers l'infini. Ce n'est pas une concentration : on borne pour rester
    // lisible plutôt que de publier un Infinity.
    parisEffectifs:
      agrege.risqueEffectif > 0
        ? Math.min(1e6, (agrege.risqueSomme / agrege.risqueEffectif) ** 2)
        : 0,
    partPositionMaxPct: dominante?.partPct ?? 0,
    positionDominante: dominante?.instrument ?? null,
    facteurs: expositionsFacteurs(positions, facteurs),
  };
}

function expositionsFacteurs(
  positions: readonly PositionRisquee[],
  facteurs: SourceFacteurs,
): ExpositionFacteur[] {
  const nets = new Map<string, { net: number; brut: number }>();

  for (const position of positions) {
    const signe = position.sens === 'ACHAT' ? 1 : -1;
    const risque = Math.abs(position.risque);
    for (const { facteur, poids } of facteurs(position.instrument)) {
      const courant = nets.get(facteur) ?? { net: 0, brut: 0 };
      courant.net += risque * poids * signe;
      courant.brut += Math.abs(risque * poids);
      nets.set(facteur, courant);
    }
  }

  return [...nets.entries()]
    .map(([facteur, valeurs]) => ({
      facteur,
      expositionNette: valeurs.net,
      expositionBrute: valeurs.brut,
    }))
    .sort((a, b) => Math.abs(b.expositionNette) - Math.abs(a.expositionNette));
}

export interface LimitesConcentration {
  /** Part maximale du risque agrégé qu'une seule position peut porter, en %. */
  readonly partPositionMaxPct: number;
  /** Exposition nette maximale d'un facteur, en % du budget de risque total. */
  readonly partFacteurMaxPct: number;
}

export interface DecisionConcentration {
  /** Risque admissible pour la position proposée, devise du compte. */
  readonly risqueAutorise: number;
  readonly refuse: boolean;
  /** Contrainte qui borne : `POSITION`, `FACTEUR`, ou `null` si aucune. */
  readonly contrainte: 'POSITION' | 'FACTEUR' | null;
  /** Facteur qui borne, quand la contrainte est `FACTEUR`. */
  readonly facteurLimitant: string | null;
  readonly analyse: AnalyseConcentration;
  readonly explication: string;
}

/**
 * Combien de risque la position proposée peut-elle prendre sans concentrer ?
 *
 * Les deux plafonds se résolvent exactement, et le plus serré l'emporte.
 *
 * **Part par position.** Avec `b` la covariance unitaire de la nouvelle
 * position avec le portefeuille et `c` la variance actuelle, sa part du risque
 * vaut `q(b + q) / (c + 2bq + q²)`. L'inégalité `part ≤ P` se réarrange en
 *
 *     (1 − P)·q² + b(1 − 2P)·q − P·c ≤ 0
 *
 * une parabole ouverte vers le haut dont le produit des racines, `−Pc/(1−P)`,
 * est négatif ou nul : il y a donc exactement une racine positive, et c'est le
 * plafond cherché.
 *
 * **Exposition par facteur.** L'exposition nette est affine en `q` :
 * `net_f(q) = base_f + u_f·q` où `u_f` vaut ±1. La contrainte `|net_f| ≤ L`
 * donne directement `q ≤ L − u_f·base_f`, minimisé sur les facteurs touchés.
 * Quand la position réduit un facteur déjà chargé, `u_f·base_f` est négatif et
 * le plafond **s'élargit** — un compteur n'aurait jamais pu voir ça.
 *
 * Un facteur déjà au-dessus du plafond mais que la position ne touche pas ne
 * provoque pas de refus : la refuser n'y changerait rien. Il est signalé.
 */
export function evaluerConcentration(
  ouvertes: readonly PositionRisquee[],
  proposee: Omit<PositionRisquee, 'risque'>,
  budget: number,
  limites: LimitesConcentration,
  correlation: SourceCorrelation,
  facteurs: SourceFacteurs,
): DecisionConcentration {
  const analyse = analyserConcentration(ouvertes, correlation, facteurs);

  const plafondPosition = plafondParPosition(ouvertes, proposee, limites, correlation);
  const parFacteur = plafondParFacteur(ouvertes, proposee, budget, limites, facteurs);

  const risqueAutorise = Math.max(0, Math.min(plafondPosition, parFacteur.plafond));
  const contrainte: DecisionConcentration['contrainte'] =
    !Number.isFinite(plafondPosition) && !Number.isFinite(parFacteur.plafond)
      ? null
      : plafondPosition <= parFacteur.plafond
        ? 'POSITION'
        : 'FACTEUR';

  return {
    risqueAutorise,
    refuse: risqueAutorise <= 0,
    contrainte,
    facteurLimitant: contrainte === 'FACTEUR' ? parFacteur.facteur : null,
    analyse,
    explication: rediger(analyse, risqueAutorise, contrainte, parFacteur.facteur, limites, budget),
  };
}

/**
 * Plafond issu de la part du risque agrégé.
 *
 * Sans position ouverte, la contrainte n'a pas de sens : une position seule
 * porte 100 % du risque du portefeuille, et tout plafond inférieur à 100 %
 * interdirait la première ouverture. On ne l'applique donc qu'à partir de la
 * deuxième position. La conséquence est assumée : la première position peut
 * rester au-dessus du plafond après coup, puisqu'on dimensionne à l'ouverture
 * sans jamais redimensionner l'existant. `AnalyseConcentration` publie la part
 * réelle pour que ce dépassement soit visible.
 */
function plafondParPosition(
  ouvertes: readonly PositionRisquee[],
  proposee: Omit<PositionRisquee, 'risque'>,
  limites: LimitesConcentration,
  correlation: SourceCorrelation,
): number {
  const part = limites.partPositionMaxPct / 100;
  if (!(part > 0)) return 0;
  if (part >= 1) return Number.POSITIVE_INFINITY;

  const actuel = risqueAgrege(ouvertes, correlation);
  const c = actuel.risqueEffectif ** 2;
  if (!(c > 0)) return Number.POSITIVE_INFINITY;

  const signe = proposee.sens === 'ACHAT' ? 1 : -1;
  const b = ouvertes.reduce((total, ouverte) => {
    const poids = Math.abs(ouverte.risque) * (ouverte.sens === 'ACHAT' ? 1 : -1);
    return total + poids * signe * borner(correlation(proposee.instrument, ouverte.instrument));
  }, 0);

  const a = 1 - part;
  const beta = b * (1 - 2 * part);
  const gamma = -part * c;

  // gamma ≤ 0 et a > 0 : le discriminant est toujours positif et la racine
  // positive existe toujours.
  const racine = (-beta + Math.sqrt(beta * beta - 4 * a * gamma)) / (2 * a);
  return Math.max(0, racine);
}

function plafondParFacteur(
  ouvertes: readonly PositionRisquee[],
  proposee: Omit<PositionRisquee, 'risque'>,
  budget: number,
  limites: LimitesConcentration,
  facteurs: SourceFacteurs,
): { plafond: number; facteur: string | null } {
  const limite = (limites.partFacteurMaxPct / 100) * budget;
  if (!(limite > 0)) return { plafond: 0, facteur: null };

  const touches = facteurs(proposee.instrument);
  if (touches.length === 0) return { plafond: Number.POSITIVE_INFINITY, facteur: null };

  const nets = new Map<string, number>();
  for (const position of ouvertes) {
    const signe = position.sens === 'ACHAT' ? 1 : -1;
    const risque = Math.abs(position.risque);
    for (const { facteur, poids } of facteurs(position.instrument)) {
      nets.set(facteur, (nets.get(facteur) ?? 0) + risque * poids * signe);
    }
  }

  const signeProposee = proposee.sens === 'ACHAT' ? 1 : -1;
  let plafond = Number.POSITIVE_INFINITY;
  let facteurLimitant: string | null = null;

  for (const { facteur, poids } of touches) {
    const unitaire = poids * signeProposee;
    if (unitaire === 0) continue;
    // |base + unitaire·q| ≤ limite, avec |unitaire| = 1.
    const candidat = (limite - unitaire * (nets.get(facteur) ?? 0)) / Math.abs(unitaire);
    if (candidat < plafond) {
      plafond = candidat;
      facteurLimitant = facteur;
    }
  }

  return { plafond: Math.max(0, plafond), facteur: facteurLimitant };
}

function rediger(
  analyse: AnalyseConcentration,
  risqueAutorise: number,
  contrainte: DecisionConcentration['contrainte'],
  facteur: string | null,
  limites: LimitesConcentration,
  budget: number,
): string {
  if (risqueAutorise <= 0) {
    if (contrainte === 'FACTEUR' && facteur) {
      const net = analyse.facteurs.find((entree) => entree.facteur === facteur)?.expositionNette ?? 0;
      return (
        `Concentration sur ${facteur} : ${Math.abs(net).toFixed(2)} d’exposition nette ` +
        `${net >= 0 ? 'longue' : 'courte'}, plafond ${((limites.partFacteurMaxPct / 100) * budget).toFixed(2)}. ` +
        'Ajouter dans le même sens revient à répéter le même pari sous un autre nom.'
      );
    }
    return (
      `Concentration : la position porterait plus de ${limites.partPositionMaxPct} % du risque ` +
      'du portefeuille à elle seule.'
    );
  }

  const morceaux: string[] = [];

  if (analyse.facteurs.length > 0 && analyse.parisEffectifs > 0) {
    morceaux.push(
      `${analyse.parisEffectifs.toFixed(1)} pari(s) effectif(s) pour ` +
        `${analyse.facteurs.length} facteur(s) exposé(s).`,
    );
  }

  if (contrainte === 'FACTEUR' && facteur) {
    morceaux.push(`Taille bornée par l’exposition nette sur ${facteur}.`);
  } else if (contrainte === 'POSITION') {
    morceaux.push(`Taille bornée à ${limites.partPositionMaxPct} % du risque agrégé.`);
  }

  const debordant = analyse.facteurs.find(
    (entree) => Math.abs(entree.expositionNette) > (limites.partFacteurMaxPct / 100) * budget,
  );
  if (debordant && debordant.facteur !== facteur) {
    morceaux.push(
      `${debordant.facteur} dépasse déjà son plafond d’exposition ` +
        `(${Math.abs(debordant.expositionNette).toFixed(2)}) : la position proposée n’y touche pas.`,
    );
  }

  return morceaux.join(' ');
}

function borner(valeur: number): number {
  return Number.isFinite(valeur) ? Math.max(-1, Math.min(1, valeur)) : 0;
}
