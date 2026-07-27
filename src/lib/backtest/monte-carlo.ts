import { drawdownMax } from './metriques';
import type { PointEquite, TradeFerme } from './moteur';

/**
 * Monte-Carlo sur l'ordre des trades.
 *
 * Un backtest ne produit qu'**un** chemin : celui dans lequel les trades sont
 * arrivés dans cet ordre-là. Le drawdown maximal qu'on en lit est donc autant
 * un accident d'ordonnancement qu'une propriété de la stratégie. Trois pertes
 * consécutives au milieu de la série creusent un trou ; les mêmes trois pertes
 * réparties n'en creusent aucun.
 *
 * D'où deux méthodes, qui ne répondent pas à la même question :
 *
 *  - **PERMUTATION** rejoue exactement les mêmes trades dans un autre ordre.
 *    Le résultat final est rigoureusement identique — seul le chemin change.
 *    C'est ce qui isole la part du drawdown due au hasard de l'ordre.
 *  - **BOOTSTRAP** tire les trades avec remise. Le résultat final varie alors
 *    aussi : on obtient la distribution des rendements qu'aurait pu produire
 *    une stratégie ayant cette distribution de trades.
 *
 * Ce que ça ne dit pas : rien sur l'avenir. Les deux méthodes supposent que
 * les trades sont interchangeables — donc pas d'autocorrélation, pas de
 * régime de marché. C'est faux en toute rigueur, et ça reste bien plus
 * informatif que le chemin unique du backtest.
 */

export type MethodeMonteCarlo = 'PERMUTATION' | 'BOOTSTRAP';

export interface OptionsMonteCarlo {
  readonly trades: readonly TradeFerme[];
  readonly capitalInitial: number;
  readonly tirages?: number;
  readonly methode?: MethodeMonteCarlo;
  /** Graine explicite : une simulation non reproductible ne se compare pas. */
  readonly graine?: number;
}

export interface ResultatMonteCarlo {
  readonly methode: MethodeMonteCarlo;
  readonly tirages: number;
  /** Drawdown maximal observé dans le backtest réel, en pourcentage. */
  readonly drawdownObserve: number;
  readonly drawdownMedian: number;
  readonly drawdownPire: number;
  /** Drawdown dépassé par seulement 5 % des tirages. */
  readonly drawdownPercentile95: number;
  readonly rendementMedianPct: number;
  readonly rendementPercentile5Pct: number;
  readonly rendementPercentile95Pct: number;
  /** Part des tirages qui finissent sous le capital de départ. */
  readonly probabilitePerte: number;
  /** Part des tirages où l'équité touche zéro. */
  readonly probabiliteRuine: number;
  readonly verdict: string;
}

const TIRAGES_DEFAUT = 2_000;

export function simulerMonteCarlo(options: OptionsMonteCarlo): ResultatMonteCarlo | null {
  const { trades, capitalInitial } = options;
  const methode = options.methode ?? 'PERMUTATION';
  const tirages = Math.max(100, Math.min(options.tirages ?? TIRAGES_DEFAUT, 20_000));

  if (trades.length < 5 || !(capitalInitial > 0)) return null;

  const resultats = trades.map((trade) => trade.resultat);
  const suivant = generateur(options.graine ?? 1);

  const drawdowns: number[] = [];
  const rendements: number[] = [];
  let ruines = 0;
  let pertes = 0;

  for (let tirage = 0; tirage < tirages; tirage += 1) {
    const serie =
      methode === 'PERMUTATION'
        ? permuter(resultats, suivant)
        : tirerAvecRemise(resultats, suivant);

    const { courbe, ruine } = reconstruireCourbe(serie, capitalInitial);

    drawdowns.push(drawdownMax(courbe));

    const finale = courbe[courbe.length - 1]!.equite;
    rendements.push(((finale - capitalInitial) / capitalInitial) * 100);
    if (ruine) ruines += 1;
    if (finale < capitalInitial) pertes += 1;
  }

  drawdowns.sort((a, b) => a - b);
  rendements.sort((a, b) => a - b);

  const observe = drawdownMax(reconstruireCourbe(resultats, capitalInitial).courbe);
  const percentile95 = percentile(drawdowns, 0.95);

  return {
    methode,
    tirages,
    drawdownObserve: observe,
    drawdownMedian: percentile(drawdowns, 0.5),
    drawdownPire: drawdowns[drawdowns.length - 1]!,
    drawdownPercentile95: percentile95,
    rendementMedianPct: percentile(rendements, 0.5),
    rendementPercentile5Pct: percentile(rendements, 0.05),
    rendementPercentile95Pct: percentile(rendements, 0.95),
    probabilitePerte: pertes / tirages,
    probabiliteRuine: ruines / tirages,
    verdict: rediger(methode, observe, percentile95, ruines / tirages),
  };
}

function rediger(
  methode: MethodeMonteCarlo,
  observe: number,
  percentile95: number,
  probabiliteRuine: number,
): string {
  const morceaux: string[] = [];

  if (probabiliteRuine > 0) {
    morceaux.push(
      `${(probabiliteRuine * 100).toFixed(1)} % des tirages ruinent le compte. ` +
        'Un ordonnancement défavorable suffit : la taille des positions est trop grande, quel que soit le résultat moyen.',
    );
  }

  if (percentile95 > observe * 1.5 && observe > 0) {
    morceaux.push(
      `Le backtest a montré ${observe.toFixed(1)} % de baisse, mais un tirage sur vingt en produit au moins ` +
        `${percentile95.toFixed(1)} %. Le chemin observé était clément — dimensionner sur lui serait une erreur.`,
    );
  } else if (observe > 0) {
    morceaux.push(
      `Le drawdown observé (${observe.toFixed(1)} %) est cohérent avec la distribution : ` +
        `le chemin du backtest n'était ni exceptionnellement chanceux ni malchanceux.`,
    );
  }

  if (methode === 'PERMUTATION') {
    morceaux.push(
      'Ces tirages rejouent exactement les mêmes trades dans un autre ordre : le résultat final ne change pas, seul le chemin varie.',
    );
  }

  return morceaux.join(' ');
}

/**
 * Reconstruit une courbe d'équité à partir d'une suite de résultats.
 *
 * Les résultats sont additifs, comme le moteur les produit. Une fois l'équité
 * à zéro, on n'ajoute plus rien : un compte ruiné ne se rétablit pas parce que
 * le trade suivant aurait été gagnant.
 */
function reconstruireCourbe(
  resultats: readonly number[],
  capitalInitial: number,
): { courbe: PointEquite[]; ruine: boolean } {
  const courbe: PointEquite[] = [{ horodatage: 0, equite: capitalInitial, solde: capitalInitial }];
  let equite = capitalInitial;
  let ruine = false;

  for (let index = 0; index < resultats.length; index += 1) {
    if (!ruine) {
      equite += resultats[index]!;
      if (equite <= 0) {
        equite = 0;
        ruine = true;
      }
    }
    courbe.push({ horodatage: index + 1, equite, solde: equite });
  }

  return { courbe, ruine };
}

/** Mélange de Fisher-Yates, sur une copie. */
function permuter(valeurs: readonly number[], suivant: () => number): number[] {
  const copie = [...valeurs];
  for (let index = copie.length - 1; index > 0; index -= 1) {
    const cible = Math.floor(suivant() * (index + 1));
    [copie[index], copie[cible]] = [copie[cible]!, copie[index]!];
  }
  return copie;
}

function tirerAvecRemise(valeurs: readonly number[], suivant: () => number): number[] {
  return Array.from(
    { length: valeurs.length },
    () => valeurs[Math.floor(suivant() * valeurs.length)]!,
  );
}

/** Interpolation linéaire entre les deux rangs encadrants. */
export function percentile(triees: readonly number[], fraction: number): number {
  if (triees.length === 0) return 0;
  if (triees.length === 1) return triees[0]!;

  const position = fraction * (triees.length - 1);
  const bas = Math.floor(position);
  const haut = Math.ceil(position);
  if (bas === haut) return triees[bas]!;

  return triees[bas]! + (triees[haut]! - triees[bas]!) * (position - bas);
}

/** xorshift32 : court, sans dépendance, et reproductible pour une graine. */
function generateur(graine: number): () => number {
  let etat = graine >>> 0 || 1;
  return () => {
    etat ^= etat << 13;
    etat ^= etat >>> 17;
    etat ^= etat << 5;
    etat >>>= 0;
    return etat / 0x100000000;
  };
}
