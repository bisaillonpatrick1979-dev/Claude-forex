import { profilHorizon, type Horizon } from '@/lib/agents/horizons';
import { clotures, derniereValeur, moyenneMobileSimple, rsi } from '@/lib/marche/indicateurs';

import type { Decideur, VueDecision } from './moteur';

/**
 * Stratégies codées, correspondant aux familles de playbooks de la maison.
 *
 * Ce ne sont pas les agents. Un agent délibère en langage naturel et coûte des
 * jetons à chaque bougie : le faire tourner sur quinze ans d'historique serait
 * ruineux et lent. Ces règles-ci sont la version mécanique et gratuite de la
 * même intention, et elles servent à répondre à une question que les agents ne
 * peuvent pas trancher seuls : **est-ce que cette famille de stratégie a le
 * moindre avantage sur cet instrument, avant même qu'on y mette du
 * raisonnement ?**
 *
 * Si le suivi de tendance mécanique perd contre l'achat-conservation sur dix
 * ans d'EUR/USD, un agent qui se réclame du suivi de tendance part avec un
 * handicap qu'aucune éloquence ne compense. C'est une information qu'on veut
 * avoir avant de dépenser en jetons, pas après.
 *
 * Chacune pose un stop. Ce n'est pas une opinion sur le stop-loss : c'est la
 * règle du serveur, qui rejette toute proposition sans stop. Une référence qui
 * s'en dispenserait ne serait pas comparable à ce que la firme sait exécuter.
 */

export type CodeStrategie = 'SUIVI_TENDANCE' | 'RETOUR_MOYENNE' | 'CASSURE_RANGE';

export interface DescriptionStrategie {
  readonly code: CodeStrategie;
  readonly nom: string;
  readonly famille: string;
  readonly resume: string;
}

export const STRATEGIES: readonly DescriptionStrategie[] = [
  {
    code: 'SUIVI_TENDANCE',
    nom: 'Suivi de tendance',
    famille: 'TENDANCE',
    resume:
      'Achète quand la moyenne courte passe au-dessus de la longue, vend dans le cas inverse. Peu de trades, beaucoup de petites pertes, quelques gains qui portent tout.',
  },
  {
    code: 'RETOUR_MOYENNE',
    nom: 'Retour à la moyenne',
    famille: 'RETOUR_MOYENNE',
    resume:
      'Achète les excès baissiers et vend les excès haussiers mesurés au RSI. Beaucoup de petits gains, quelques pertes qui peuvent tout reprendre.',
  },
  {
    code: 'CASSURE_RANGE',
    nom: 'Cassure de range',
    famille: 'CASSURE',
    resume:
      'Entre dans le sens de la sortie du plus haut ou du plus bas des N dernières bougies. Taux de réussite bas assumé, gains asymétriques.',
  },
];

/** Risque par position, en fraction de l'équité. Volontairement modeste : on
 *  mesure un avantage de règle, pas un talent de dimensionnement. */
const RISQUE_PAR_TRADE = 0.01;

/**
 * Horizon appliqué au dimensionnement.
 *
 * Le même signal ne se joue pas pareil selon l'horizon : le stop et la cible
 * viennent du profil, pas de constantes maison. C'est ce qui permet de poser la
 * question qui compte — « cette famille de stratégie survit-elle aux frais en
 * scalping ? » — plutôt que de mesurer une seule variante arbitraire.
 *
 * Un module tourne à horizon fixe pendant tout le backtest ; le changer entre
 * deux essais est le geste de comparaison qu'on veut rendre possible.
 */
let horizonCourant: Horizon = 'INTRADAY';

export function fixerHorizonStrategies(horizon: Horizon): void {
  horizonCourant = horizon;
}

const suiviTendance: Decideur = (vue) => {
  const prix = clotures(vue.bougies);
  const courte = derniereValeur(moyenneMobileSimple(prix, 20));
  const longue = derniereValeur(moyenneMobileSimple(prix, 50));
  if (courte === null || longue === null) return {};

  const haussier = courte > longue;
  const position = vue.positions[0];

  // Le retournement de la moyenne ferme avant d'ouvrir dans l'autre sens : on
  // ne se retrouve jamais long et short du même instrument.
  if (position && ((position.sens === 'ACHAT') !== haussier)) {
    return { fermetures: [{ positionId: position.id }] };
  }
  if (position || vue.ordresEnAttente.length > 0) return {};

  return ordre(vue, haussier ? 'ACHAT' : 'VENTE');
};

const retourMoyenne: Decideur = (vue) => {
  const valeurRsi = derniereValeur(rsi(clotures(vue.bougies), 14));
  if (valeurRsi === null) return {};

  const position = vue.positions[0];
  if (position) {
    // Sortie au retour vers la zone neutre, sans attendre l'excès inverse.
    const revenu =
      position.sens === 'ACHAT' ? valeurRsi >= 50 : valeurRsi <= 50;
    return revenu ? { fermetures: [{ positionId: position.id }] } : {};
  }
  if (vue.ordresEnAttente.length > 0) return {};

  if (valeurRsi < 30) return ordre(vue, 'ACHAT');
  if (valeurRsi > 70) return ordre(vue, 'VENTE');
  return {};
};

const FENETRE_RANGE = 20;

const cassureRange: Decideur = (vue) => {
  if (vue.positions.length > 0 || vue.ordresEnAttente.length > 0) return {};
  if (vue.bougies.length < FENETRE_RANGE + 1) return {};

  // La fenêtre exclut la bougie courante : comparer une clôture au plus haut
  // d'une plage qui la contient déclarerait une cassure à chaque nouveau
  // sommet, y compris celui qu'on vient tout juste de fabriquer.
  const fenetre = vue.bougies.slice(-FENETRE_RANGE - 1, -1);
  const plusHaut = Math.max(...fenetre.map((bougie) => bougie.haut));
  const plusBas = Math.min(...fenetre.map((bougie) => bougie.bas));

  if (vue.bougie.cloture > plusHaut) return ordre(vue, 'ACHAT');
  if (vue.bougie.cloture < plusBas) return ordre(vue, 'VENTE');
  return {};
};

/**
 * Taille dérivée du risque et de la distance au stop, jamais fixée d'avance :
 * une taille constante fait risquer dix fois plus en marché agité qu'en marché
 * calme, ce qui rend toute comparaison entre périodes illisible.
 */
function ordre(vue: VueDecision, sens: 'ACHAT' | 'VENTE') {
  const valeurAtr = vue.atr;
  if (valeurAtr === null || valeurAtr <= 0) return {};

  const profil = profilHorizon(horizonCourant);
  const distanceStop = valeurAtr * profil.multipleStopAtr;
  const valeurPoint = vue.instrument.tailleContrat;
  const risque = vue.portefeuille.equite * RISQUE_PAR_TRADE;
  const quantite = risque / (distanceStop * valeurPoint);

  // Sous un centième de lot, l'ordre serait rejeté à l'exécution : mieux vaut
  // s'abstenir que d'accumuler des rejets qui ressemblent à des décisions.
  if (!(quantite >= 0.01)) return {};

  const prix = vue.bougie.cloture;
  return {
    ordres: [
      {
        sens,
        quantite: Number(quantite.toFixed(2)),
        stopLoss: sens === 'ACHAT' ? prix - distanceStop : prix + distanceStop,
        takeProfit:
          sens === 'ACHAT'
            ? prix + valeurAtr * profil.multipleCibleAtr
            : prix - valeurAtr * profil.multipleCibleAtr,
      },
    ],
  };
}

export function decideurStrategie(code: CodeStrategie): Decideur {
  switch (code) {
    case 'SUIVI_TENDANCE':
      return suiviTendance;
    case 'RETOUR_MOYENNE':
      return retourMoyenne;
    case 'CASSURE_RANGE':
      return cassureRange;
  }
}
