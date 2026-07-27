import { calculerMetriques, type Metriques } from './metriques';
import { executerBacktest, type Decideur, type OptionsBacktest } from './moteur';

/**
 * Comparateurs obligatoires.
 *
 * Un rendement nu ne dit rien. « +18 % sur trois ans » est excellent si le
 * marché a fait −5 %, et lamentable s'il a fait +60 % — la stratégie aura
 * alors coûté cher pour faire moins bien que ne rien décider du tout. Et
 * « 58 % de trades gagnants » n'impressionne que tant qu'on n'a pas vu que
 * lancer une pièce en donne 51 % sur la même série, coûts compris.
 *
 * D'où deux références calculées systématiquement, avec **le même moteur, le
 * même instrument, les mêmes coûts et la même barrière anti-look-ahead** que
 * la stratégie évaluée. Les faire tourner sur un modèle plus clément
 * truquerait la comparaison dans le sens qui flatte, ce qui est exactement ce
 * qu'on cherche à empêcher.
 *
 * Elles sont affichées même — surtout — quand elles gagnent.
 */

export interface Comparateur {
  readonly code: 'ACHAT_CONSERVATION' | 'HASARD';
  readonly nom: string;
  readonly metriques: Metriques;
  readonly explication: string;
}

export interface OptionsComparateurs {
  readonly base: Omit<OptionsBacktest, 'decideur'>;
  /** Taille de position des références. À aligner sur la stratégie évaluée. */
  readonly quantite: number;
  /** Nombre de trades de la stratégie évaluée : le hasard en fera autant. */
  readonly tradesReference: number;
  /** Graine du comparateur aléatoire. Fixe = résultat reproductible. */
  readonly graine?: number;
}

export function calculerComparateurs(options: OptionsComparateurs): readonly Comparateur[] {
  return [
    executer(
      'ACHAT_CONSERVATION',
      'Achat et conservation',
      decideurAchatConservation(options.quantite),
      options.base,
      'Acheter à la première bougie exploitable et ne plus rien faire. C’est le rendement du marché lui-même, frais d’entrée compris : toute stratégie qui fait moins a coûté de l’argent pour rien.',
    ),
    executer(
      'HASARD',
      'Stratégie aléatoire',
      decideurAleatoire(options.quantite, options.tradesReference, options.graine ?? 1),
      options.base,
      'Même nombre de positions, même taille, sens tiré au sort. C’est le niveau de la chance : une stratégie qui ne le dépasse pas nettement n’a rien démontré, quel que soit son taux de réussite.',
    ),
  ];
}

function executer(
  code: Comparateur['code'],
  nom: string,
  decideur: Decideur,
  base: Omit<OptionsBacktest, 'decideur'>,
  explication: string,
): Comparateur {
  const resultat = executerBacktest({ ...base, decideur });
  return {
    code,
    nom,
    metriques: calculerMetriques(resultat.courbeEquite, resultat.trades, base.intervalle),
    explication,
  };
}

/**
 * Achat et conservation.
 *
 * Une seule position, ouverte dès que le décideur est appelé, jamais fermée
 * volontairement — le moteur la liquide en fin de série. Sans stop : en poser
 * un ferait de la référence une stratégie de plus, avec ses propres choix à
 * défendre.
 */
export function decideurAchatConservation(quantite: number): Decideur {
  let engagee = false;
  return (vue) => {
    if (engagee || vue.positions.length > 0 || vue.ordresEnAttente.length > 0) return {};
    engagee = true;
    return { ordres: [{ sens: 'ACHAT', quantite, stopLoss: null, takeProfit: null }] };
  };
}

/**
 * Stratégie aléatoire, à fréquence imposée.
 *
 * Deux exigences qui la rendent honnête :
 *
 *  - **reproductible.** Générateur à graine explicite, jamais `Math.random()` :
 *    une référence qui change à chaque exécution ne permet aucune comparaison,
 *    et invite à relancer jusqu'à obtenir le verdict qui arrange.
 *  - **de même fréquence.** Elle prend autant de positions que la stratégie
 *    évaluée. Comparer une stratégie à trois cents trades à un hasard qui n'en
 *    prend que dix comparerait surtout deux expositions aux coûts.
 */
export function decideurAleatoire(quantite: number, trades: number, graine: number): Decideur {
  let suivante = graine >>> 0;
  const prochain = (): number => {
    // xorshift32 : court, sans dépendance, suffisant pour tirer un sens.
    suivante ^= suivante << 13;
    suivante ^= suivante >>> 17;
    suivante ^= suivante << 5;
    suivante >>>= 0;
    return suivante / 0xffffffff;
  };

  let ouvertes = 0;
  let barresRestantes = 0;

  return (vue) => {
    const total = Math.max(1, vue.bougies.length);
    const cadence = Math.max(1, Math.floor(total / Math.max(1, trades)));

    if (vue.positions.length > 0) {
      barresRestantes -= 1;
      if (barresRestantes > 0) return {};
      return { fermetures: vue.positions.map((position) => ({ positionId: position.id })) };
    }

    if (ouvertes >= trades || vue.ordresEnAttente.length > 0) return {};
    if (vue.index % cadence !== 0) return {};

    ouvertes += 1;
    // Durée de détention tirée elle aussi, dans la même plage que la cadence :
    // une référence qui garderait tout jusqu'à la fin serait un second achat-
    // conservation déguisé.
    barresRestantes = 1 + Math.floor(prochain() * cadence);
    return {
      ordres: [
        {
          sens: prochain() < 0.5 ? 'ACHAT' : 'VENTE',
          quantite,
          stopLoss: null,
          takeProfit: null,
        },
      ],
    };
  };
}

/** Verdict lisible : la stratégie a-t-elle battu ses références ? */
export function verdict(
  strategie: Metriques,
  comparateurs: readonly Comparateur[],
): string {
  const battus = comparateurs.filter(
    (comparateur) => strategie.rendementPct > comparateur.metriques.rendementPct,
  );

  if (battus.length === comparateurs.length) {
    return `La stratégie devance ses ${comparateurs.length} références sur le rendement. À confirmer sur une autre période avant d’en conclure quoi que ce soit.`;
  }
  if (battus.length === 0) {
    const noms = comparateurs.map((comparateur) => comparateur.nom.toLowerCase()).join(' et ');
    return `La stratégie fait moins bien que ${noms}. Elle a coûté du risque et des frais sans rien apporter sur cette période.`;
  }
  const perdus = comparateurs
    .filter((comparateur) => strategie.rendementPct <= comparateur.metriques.rendementPct)
    .map((comparateur) => comparateur.nom.toLowerCase())
    .join(' et ');
  return `Résultat mitigé : la stratégie ne devance pas ${perdus}.`;
}
