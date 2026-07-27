import { dureeSecondes } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';

import type { PointEquite, TradeFerme } from './moteur';

/**
 * Métriques d'un backtest.
 *
 * Le rendement seul ne dit rien : doubler son capital en encaissant 60 % de
 * baisse en chemin n'est pas le même métier que le doubler en encaissant 8 %.
 * D'où le drawdown et le Sharpe à côté, systématiquement — et le nombre de
 * trades, sans lequel aucun des deux ne veut dire grand-chose.
 *
 * Un choix explicite : **le rendement se lit sur l'équité, pas sur le solde.**
 * Le solde ignore les positions ouvertes ; une stratégie qui finit avec une
 * perte latente colossale afficherait un solde flatteur. L'équité inclut ce
 * qu'on doit encore assumer.
 *
 * Et un avertissement inscrit dans le code parce qu'il se perd vite : ces
 * chiffres décrivent le passé sur une série. Ils ne prédisent rien. Leur
 * unique usage honnête est comparatif — cette stratégie contre l'achat-
 * conservation, contre le hasard, contre elle-même sur une autre période.
 */

export interface Metriques {
  readonly capitalInitial: number;
  readonly equiteFinale: number;
  readonly rendementPct: number;
  /** Rendement annualisé composé. `null` si la période est trop courte. */
  readonly rendementAnnualisePct: number | null;
  readonly drawdownMaxPct: number;
  /** Volatilité annualisée des rendements par bougie, en pourcentage. */
  readonly volatilitePct: number | null;
  readonly sharpe: number | null;
  /** Comme Sharpe, mais ne pénalise que la volatilité baissière. */
  readonly sortino: number | null;
  readonly trades: number;
  readonly tauxReussitePct: number | null;
  /** Somme des gains ÷ somme des pertes. Au-dessus de 1, la stratégie gagne. */
  readonly facteurProfit: number | null;
  readonly gainMoyen: number | null;
  readonly perteMoyenne: number | null;
  readonly esperanceParTrade: number | null;
  readonly pireSerieDePertes: number;
  readonly dureeJours: number;
}

/** Taux sans risque supposé nul : sur une comparaison relative, l'ajouter des
 *  deux côtés ne changerait aucun classement, et le choisir se discuterait. */
const TAUX_SANS_RISQUE = 0;

export function calculerMetriques(
  courbe: readonly PointEquite[],
  trades: readonly TradeFerme[],
  intervalle: Intervalle,
): Metriques {
  const capitalInitial = courbe[0]?.equite ?? 0;
  const equiteFinale = courbe[courbe.length - 1]?.equite ?? capitalInitial;

  const rendements = rendementsParBougie(courbe);
  const parAn = bougiesParAn(intervalle);
  const dureeJours =
    courbe.length >= 2
      ? (courbe[courbe.length - 1]!.horodatage - courbe[0]!.horodatage) / 86_400
      : 0;

  const ecartType = ecartTypeEchantillon(rendements);
  const ecartTypeBaissier = ecartTypeEchantillon(rendements.filter((valeur) => valeur < 0));
  const moyenne = moyenneOuNull(rendements);

  const gains = trades.filter((trade) => trade.resultat > 0);
  const pertes = trades.filter((trade) => trade.resultat < 0);
  const sommeGains = gains.reduce((total, trade) => total + trade.resultat, 0);
  const sommePertes = Math.abs(pertes.reduce((total, trade) => total + trade.resultat, 0));

  return {
    capitalInitial,
    equiteFinale,
    rendementPct: capitalInitial > 0 ? ((equiteFinale - capitalInitial) / capitalInitial) * 100 : 0,
    rendementAnnualisePct: annualiser(capitalInitial, equiteFinale, dureeJours),
    drawdownMaxPct: drawdownMax(courbe),
    volatilitePct: ecartType === null ? null : ecartType * Math.sqrt(parAn) * 100,
    sharpe:
      moyenne === null || ecartType === null || ecartType === 0
        ? null
        : ((moyenne - TAUX_SANS_RISQUE) / ecartType) * Math.sqrt(parAn),
    sortino:
      moyenne === null || ecartTypeBaissier === null || ecartTypeBaissier === 0
        ? null
        : ((moyenne - TAUX_SANS_RISQUE) / ecartTypeBaissier) * Math.sqrt(parAn),
    trades: trades.length,
    tauxReussitePct: trades.length === 0 ? null : (gains.length / trades.length) * 100,
    // Aucune perte : le facteur est infini. `null` plutôt que `Infinity`, que
    // l'interface afficherait comme un exploit alors qu'il signale surtout un
    // échantillon trop petit pour conclure.
    facteurProfit: sommePertes === 0 ? null : sommeGains / sommePertes,
    gainMoyen: gains.length === 0 ? null : sommeGains / gains.length,
    perteMoyenne: pertes.length === 0 ? null : -sommePertes / pertes.length,
    esperanceParTrade:
      trades.length === 0
        ? null
        : trades.reduce((total, trade) => total + trade.resultat, 0) / trades.length,
    pireSerieDePertes: pireSerie(trades),
    dureeJours,
  };
}

/**
 * Drawdown maximal, mesuré sur le sommet **courant** et non sur le sommet
 * final. Comparer chaque creux au sommet atteint plus tard sous-estimerait la
 * douleur réellement traversée.
 */
export function drawdownMax(courbe: readonly PointEquite[]): number {
  let sommet = Number.NEGATIVE_INFINITY;
  let pire = 0;

  for (const point of courbe) {
    if (point.equite > sommet) sommet = point.equite;
    if (sommet > 0) {
      const baisse = ((sommet - point.equite) / sommet) * 100;
      if (baisse > pire) pire = baisse;
    }
  }
  return pire;
}

function rendementsParBougie(courbe: readonly PointEquite[]): readonly number[] {
  const rendements: number[] = [];
  for (let index = 1; index < courbe.length; index += 1) {
    const avant = courbe[index - 1]!.equite;
    if (avant <= 0) continue;
    rendements.push((courbe[index]!.equite - avant) / avant);
  }
  return rendements;
}

function bougiesParAn(intervalle: Intervalle): number {
  return (365 * 86_400) / dureeSecondes(intervalle);
}

function moyenneOuNull(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  return valeurs.reduce((total, valeur) => total + valeur, 0) / valeurs.length;
}

/** Écart type d'échantillon (dénominateur n − 1) : la série observée est un
 *  échantillon du comportement de la stratégie, pas la population entière. */
function ecartTypeEchantillon(valeurs: readonly number[]): number | null {
  if (valeurs.length < 2) return null;
  const moyenne = valeurs.reduce((total, valeur) => total + valeur, 0) / valeurs.length;
  const variance =
    valeurs.reduce((total, valeur) => total + (valeur - moyenne) ** 2, 0) / (valeurs.length - 1);
  return Math.sqrt(variance);
}

function annualiser(initial: number, final: number, jours: number): number | null {
  // Sous un mois, l'annualisation transforme le bruit en prophétie : trois
  // bonnes journées deviennent « 900 % par an ». On s'abstient.
  if (initial <= 0 || final <= 0 || jours < 30) return null;
  return ((final / initial) ** (365 / jours) - 1) * 100;
}

function pireSerie(trades: readonly TradeFerme[]): number {
  let courante = 0;
  let pire = 0;
  for (const trade of trades) {
    if (trade.resultat < 0) {
      courante += 1;
      if (courante > pire) pire = courante;
    } else {
      courante = 0;
    }
  }
  return pire;
}
