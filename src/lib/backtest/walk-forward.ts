import type { Chandelier, Intervalle } from '@/lib/marche/types';

import { calculerMetriques, type Metriques } from './metriques';
import { executerBacktest, type Decideur, type PointEquite, type TradeFerme } from './moteur';
import type { Instrument } from '@/lib/execution/types';
import { sharpeDeflate, sharpeParPeriode, type ResultatDSR } from './statistiques';

/**
 * Validation par fenêtres glissantes.
 *
 * Un backtest classique choisit la meilleure stratégie **sur les mêmes données
 * qui servent à la juger**. C'est le défaut central de presque tout ce qui se
 * publie : la stratégie retenue est celle qui collait le mieux au passé, et
 * son score mesure cette adhérence, pas un avantage.
 *
 * Le walk-forward coupe le lien. Sur chaque fenêtre :
 *
 *   1. on choisit un candidat en ne regardant que la période d'apprentissage ;
 *   2. on le mesure sur la période suivante, **jamais consultée pour choisir** ;
 *   3. on avance et on recommence.
 *
 * Le seul chiffre qui compte ensuite est l'agrégat hors échantillon. Le score
 * d'apprentissage est publié à côté, et l'écart entre les deux est
 * l'information la plus utile du rapport : un apprentissage brillant suivi
 * d'un hors-échantillon médiocre est la signature du surajustement.
 *
 * Un candidat peut être une famille de stratégie, un jeu de paramètres, un
 * horizon — le module ne le sait pas et n'a pas à le savoir.
 */

export interface CandidatWalkForward {
  readonly code: string;
  readonly nom: string;
  /** Fabrique un décideur neuf. Indispensable : un décideur porte un état
   *  interne, le réutiliser d'une fenêtre à l'autre ferait fuiter du passé. */
  readonly fabriquer: () => Decideur;
}

export interface OptionsWalkForward {
  readonly chandeliers: readonly Chandelier[];
  readonly instrument: Instrument;
  readonly intervalle: Intervalle;
  readonly capitalInitial: number;
  readonly candidats: readonly CandidatWalkForward[];
  /** Bougies de la période d'apprentissage. */
  readonly fenetreApprentissage: number;
  /** Bougies de la période de validation qui suit. */
  readonly fenetreValidation: number;
  readonly echauffement?: number;
}

export interface FenetreWalkForward {
  readonly index: number;
  readonly debutApprentissage: number;
  readonly finApprentissage: number;
  readonly finValidation: number;
  readonly candidatRetenu: string;
  readonly metriquesApprentissage: Metriques;
  readonly metriquesValidation: Metriques;
  /** Score de chaque candidat en apprentissage : la base du choix. */
  readonly scoresApprentissage: Readonly<Record<string, number>>;
}

export interface RapportWalkForward {
  readonly fenetres: readonly FenetreWalkForward[];
  /** Métriques de la concaténation de toutes les périodes de validation. */
  readonly horsEchantillon: Metriques;
  /** Métriques agrégées des périodes d'apprentissage, pour comparaison. */
  readonly enEchantillon: Metriques;
  /** Écart de rendement entre apprentissage et validation, en points. */
  readonly degradation: number;
  readonly significativite: ResultatDSR | null;
  /** Part des fenêtres dont la validation est positive. */
  readonly partFenetresGagnantes: number;
  readonly verdict: string;
}

export function executerWalkForward(options: OptionsWalkForward): RapportWalkForward | null {
  const { chandeliers, fenetreApprentissage, fenetreValidation, candidats } = options;

  if (candidats.length === 0) return null;
  if (fenetreApprentissage < 50 || fenetreValidation < 10) return null;
  if (chandeliers.length < fenetreApprentissage + fenetreValidation) return null;

  const fenetres: FenetreWalkForward[] = [];
  const tradesValidation: TradeFerme[] = [];
  const tradesApprentissage: TradeFerme[] = [];
  const equiteValidation: PointEquite[] = [];
  const equiteApprentissage: PointEquite[] = [];
  const sharpesEssais: number[] = [];

  let debut = 0;
  let index = 0;

  while (debut + fenetreApprentissage + fenetreValidation <= chandeliers.length) {
    const finApprentissage = debut + fenetreApprentissage;
    const finValidation = finApprentissage + fenetreValidation;

    const apprentissage = chandeliers.slice(debut, finApprentissage);
    // La validation reçoit la queue de l'apprentissage en échauffement : sans
    // elle, les indicateurs repartiraient de zéro à chaque fenêtre et les
    // premières bougies seraient décidées à l'aveugle.
    const echauffement = options.echauffement ?? 50;
    const debutAvecMarge = Math.max(0, finApprentissage - echauffement);
    const validation = chandeliers.slice(debutAvecMarge, finValidation);

    const scores: Record<string, number> = {};
    let meilleur: { candidat: CandidatWalkForward; score: number } | null = null;
    let metriquesMeilleur: Metriques | null = null;
    let tradesMeilleur: readonly TradeFerme[] = [];
    let courbeMeilleur: readonly PointEquite[] = [];

    for (const candidat of candidats) {
      const resultat = executerBacktest({
        chandeliers: apprentissage,
        instrument: options.instrument,
        intervalle: options.intervalle,
        capitalInitial: options.capitalInitial,
        decideur: candidat.fabriquer(),
        echauffement,
      });

      const metriques = calculerMetriques(
        resultat.courbeEquite,
        resultat.trades,
        options.intervalle,
      );
      const score = scorer(metriques);
      scores[candidat.code] = score;

      // Chaque essai compte dans la correction pour essais multiples, y
      // compris les perdants. Ne retenir que les gagnants sous-estimerait le
      // seuil du hasard, et c'est exactement la façon de se croire
      // significatif à tort.
      const sharpe = sharpeParPeriode(rendementsDeLaCourbe(resultat.courbeEquite));
      if (sharpe !== null) sharpesEssais.push(sharpe);

      if (!meilleur || score > meilleur.score) {
        meilleur = { candidat, score };
        metriquesMeilleur = metriques;
        tradesMeilleur = resultat.trades;
        courbeMeilleur = resultat.courbeEquite;
      }
    }

    if (!meilleur || !metriquesMeilleur) break;

    // Le décideur retenu repart neuf sur la validation : il ne conserve rien
    // de la période où il a été choisi.
    const horsEchantillon = executerBacktest({
      chandeliers: validation,
      instrument: options.instrument,
      intervalle: options.intervalle,
      capitalInitial: options.capitalInitial,
      decideur: meilleur.candidat.fabriquer(),
      echauffement,
    });

    const metriquesValidation = calculerMetriques(
      horsEchantillon.courbeEquite,
      horsEchantillon.trades,
      options.intervalle,
    );

    fenetres.push({
      index,
      debutApprentissage: apprentissage[0]?.horodatage ?? 0,
      finApprentissage: apprentissage[apprentissage.length - 1]?.horodatage ?? 0,
      finValidation: validation[validation.length - 1]?.horodatage ?? 0,
      candidatRetenu: meilleur.candidat.code,
      metriquesApprentissage: metriquesMeilleur,
      metriquesValidation,
      scoresApprentissage: scores,
    });

    tradesValidation.push(...horsEchantillon.trades);
    tradesApprentissage.push(...tradesMeilleur);
    equiteValidation.push(...recoller(equiteValidation, horsEchantillon.courbeEquite));
    equiteApprentissage.push(...recoller(equiteApprentissage, courbeMeilleur));

    debut += fenetreValidation;
    index += 1;
  }

  if (fenetres.length === 0) return null;

  const horsEchantillon = calculerMetriques(equiteValidation, tradesValidation, options.intervalle);
  const enEchantillon = calculerMetriques(
    equiteApprentissage,
    tradesApprentissage,
    options.intervalle,
  );

  const gagnantes = fenetres.filter(
    (fenetre) => fenetre.metriquesValidation.rendementPct > 0,
  ).length;

  const significativite = sharpeDeflate(rendementsDeLaCourbe(equiteValidation), sharpesEssais);
  const degradation = enEchantillon.rendementPct - horsEchantillon.rendementPct;

  return {
    fenetres,
    horsEchantillon,
    enEchantillon,
    degradation,
    significativite,
    partFenetresGagnantes: gagnantes / fenetres.length,
    verdict: rediger(fenetres.length, gagnantes, degradation, horsEchantillon, significativite),
  };
}

/**
 * Score de sélection en apprentissage.
 *
 * Le rendement seul choisirait systématiquement la stratégie la plus risquée.
 * On retient le rendement rapporté au drawdown — le rapport que quelqu'un qui
 * doit vivre avec la position regarde réellement — et on écarte les candidats
 * dont l'échantillon est trop maigre pour signifier quoi que ce soit.
 */
function scorer(metriques: Metriques): number {
  if (metriques.trades < 5) return Number.NEGATIVE_INFINITY;
  const denominateur = Math.max(1, metriques.drawdownMaxPct);
  return metriques.rendementPct / denominateur;
}

function rendementsDeLaCourbe(courbe: readonly PointEquite[]): number[] {
  const rendements: number[] = [];
  for (let index = 1; index < courbe.length; index += 1) {
    const avant = courbe[index - 1]!.equite;
    if (avant <= 0) continue;
    rendements.push((courbe[index]!.equite - avant) / avant);
  }
  return rendements;
}

/**
 * Recolle une courbe de fenêtre à la suite de la précédente.
 *
 * Chaque fenêtre repart du capital initial ; les concaténer telles quelles
 * produirait des chutes verticales artificielles à chaque jointure, qui
 * gonfleraient le drawdown agrégé. On translate donc la nouvelle courbe pour
 * qu'elle démarre là où la précédente s'est arrêtée.
 */
function recoller(
  accumulee: readonly PointEquite[],
  nouvelle: readonly PointEquite[],
): PointEquite[] {
  if (nouvelle.length === 0) return [];
  const depart = accumulee[accumulee.length - 1]?.equite;
  if (depart === undefined) return [...nouvelle];

  const decalage = depart - nouvelle[0]!.equite;
  return nouvelle.map((point) => ({
    horodatage: point.horodatage,
    equite: point.equite + decalage,
    solde: point.solde + decalage,
  }));
}

function rediger(
  nombreFenetres: number,
  gagnantes: number,
  degradation: number,
  horsEchantillon: Metriques,
  significativite: ResultatDSR | null,
): string {
  const morceaux: string[] = [
    `${nombreFenetres} fenêtre${nombreFenetres > 1 ? 's' : ''} de validation, ` +
      `${gagnantes} positive${gagnantes > 1 ? 's' : ''}. ` +
      `Hors échantillon : ${horsEchantillon.rendementPct >= 0 ? '+' : ''}${horsEchantillon.rendementPct.toFixed(1)} %.`,
  ];

  if (degradation > 20) {
    morceaux.push(
      `L'apprentissage rendait ${degradation.toFixed(0)} points de plus que la validation : ` +
        'écart caractéristique du surajustement — la règle collait au passé plutôt qu’au marché.',
    );
  }

  if (horsEchantillon.rendementPct <= 0) {
    morceaux.push(
      'Le résultat hors échantillon est négatif : quelle que soit la beauté de la courbe d’apprentissage, cette stratégie n’a rien démontré.',
    );
  }

  if (significativite) morceaux.push(significativite.verdict);

  return morceaux.join(' ');
}
