import { describe, expect, it } from 'vitest';

import { simulerMonteCarlo } from '@/lib/backtest/monte-carlo';
import type { TradeFerme } from '@/lib/backtest/moteur';
import {
  moments,
  phi,
  phiInverse,
  sharpeDeflate,
  sharpeMaximalAttendu,
  sharpeParPeriode,
  sharpeProbabiliste,
} from '@/lib/backtest/statistiques';
import { executerWalkForward, type CandidatWalkForward } from '@/lib/backtest/walk-forward';
import { dureeSecondes } from '@/lib/marche/intervalles';
import type { Chandelier } from '@/lib/marche/types';

import { EURUSD } from '../aides/instruments';

/**
 * Ce que ces tests protègent tient en une phrase : **essayer beaucoup de
 * stratégies sur des données aléatoires finit toujours par en produire une
 * excellente.** Sans correction, on la retiendrait et on la croirait.
 *
 * Le test central donne donc au système une série sans aucune structure
 * exploitable, et vérifie qu'il refuse de crier victoire.
 */

const H1 = dureeSecondes('H1');
const DEBUT = Math.floor(Date.UTC(2026, 0, 5) / 1000);

describe('fonctions de répartition', () => {
  it('rend les valeurs connues de la loi normale', () => {
    expect(phi(0)).toBeCloseTo(0.5, 6);
    expect(phi(1.6448536)).toBeCloseTo(0.95, 5);
    expect(phi(-1.6448536)).toBeCloseTo(0.05, 5);
    expect(phi(1.959964)).toBeCloseTo(0.975, 5);
  });

  it('inverse correctement sa propre fonction de répartition', () => {
    for (const p of [0.01, 0.1, 0.5, 0.9, 0.975, 0.999]) {
      expect(phi(phiInverse(p))).toBeCloseTo(p, 5);
    }
  });

  it('reste précise très près de 1, là où le seuil du hasard se calcule', () => {
    // sharpeMaximalAttendu évalue Φ⁻¹(1 − 1/N) : avec N grand, on frôle 1 et
    // une approximation grossière dériverait franchement.
    expect(phiInverse(1 - 1 / 1000)).toBeCloseTo(3.0902323, 4);
    expect(phiInverse(1 - 1 / 10000)).toBeCloseTo(3.7190165, 4);
  });
});

describe('moments d’une série', () => {
  it('reconnaît une série symétrique', () => {
    const m = moments([-2, -1, 0, 1, 2])!;
    expect(m.moyenne).toBeCloseTo(0, 10);
    expect(m.asymetrie).toBeCloseTo(0, 10);
  });

  it('détecte une asymétrie négative : beaucoup de petits gains, une perte brutale', () => {
    // C'est le profil qui ruine les vendeurs d'options — un Sharpe flatteur
    // masquant une queue à gauche.
    const m = moments([1, 1, 1, 1, 1, 1, 1, 1, 1, -20])!;
    expect(m.asymetrie).toBeLessThan(-2);
  });

  it('rend un aplatissement de 3 sur une loi proche de la normale', () => {
    const valeurs = Array.from({ length: 400 }, (_, index) =>
      // Somme de douze uniformes : approximation classique d'une normale.
      Array.from({ length: 12 }, (_, k) => ((index * 37 + k * 101) % 1000) / 1000).reduce(
        (t, v) => t + v,
        -6,
      ),
    );
    expect(moments(valeurs)!.aplatissement).toBeGreaterThan(2.2);
    expect(moments(valeurs)!.aplatissement).toBeLessThan(3.8);
  });

  it('refuse de calculer sur moins de deux points', () => {
    expect(moments([1])).toBeNull();
  });
});

describe('Sharpe probabiliste', () => {
  // Longueurs multiples de trois : le sous-échantillon garde exactement la
  // même proportion de pertes, donc exactement le même Sharpe par période.
  // Sans ça, on comparerait deux séries différentes et le test ne dirait rien.
  const bonneSerie = Array.from({ length: 501 }, (_, index) =>
    index % 3 === 0 ? -0.004 : 0.006,
  );

  it('gagne en confiance à mesure que l’échantillon grandit', () => {
    const court = sharpeProbabiliste(bonneSerie.slice(0, 21))!;
    const long = sharpeProbabiliste(bonneSerie)!;

    // Les deux séries ont la même moyenne et le même écart type de
    // population, mais le Sharpe se calcule sur l'écart type d'échantillon :
    // il vaut donc Sharpe_population × √((n−1)/n), soit un peu moins sur le
    // petit échantillon. L'écart est réel et attendu — 2,4 % ici — pas une
    // erreur de construction.
    expect(court.sharpeObserve).toBeLessThan(long.sharpeObserve);
    expect(long.sharpeObserve / court.sharpeObserve).toBeCloseTo(
      Math.sqrt((501 - 1) / 501) / Math.sqrt((21 - 1) / 21),
      6,
    );

    // Ce qui compte : à processus identique, la confiance monte franchement
    // avec la taille de l'échantillon. C'est tout l'objet du PSR.
    expect(long.probabilite).toBeGreaterThan(0.99);
    expect(court.probabilite).toBeLessThan(0.99);
  });

  it('pénalise l’asymétrie négative à Sharpe égal', () => {
    // Deux séries de même moyenne et même écart type. Celle dont les pertes
    // sont rares et violentes doit inspirer moins confiance.
    const propre = [...Array(100)].map((_, i) => (i % 2 === 0 ? 0.01 : -0.006));
    const sale = [...Array(99)].map(() => 0.002).concat([-0.196]);

    const a = sharpeProbabiliste(propre)!;
    const b = sharpeProbabiliste(sale)!;

    expect(b.sharpeObserve).toBeLessThan(a.sharpeObserve);
    expect(b.probabilite).toBeLessThan(a.probabilite);
  });

  it('reste sous la moitié quand la moyenne est négative', () => {
    const perdante = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? 0.01 : -0.005));
    expect(sharpeProbabiliste(perdante)!.probabilite).toBeLessThan(0.5);
  });
});

describe('seuil du hasard et Sharpe dégonflé', () => {
  it('relève le seuil à mesure qu’on multiplie les essais', () => {
    // Le cœur du problème : plus on cherche, plus le meilleur résultat est
    // bon — même quand il n'y a rien à trouver.
    const dix = sharpeMaximalAttendu(10, 0.25);
    const cent = sharpeMaximalAttendu(100, 0.25);
    const mille = sharpeMaximalAttendu(1000, 0.25);

    expect(cent).toBeGreaterThan(dix);
    expect(mille).toBeGreaterThan(cent);
  });

  it('ne relève rien quand tous les essais se valent', () => {
    // Variance nulle entre essais : aucun n'a été « choisi » parmi d'autres.
    expect(sharpeMaximalAttendu(500, 0)).toBe(0);
  });

  it('déclare significatif un avantage net trouvé en un seul essai', () => {
    const serie = Array.from({ length: 600 }, (_, i) => (i % 3 === 0 ? -0.003 : 0.007));
    const verdict = sharpeDeflate(serie, [0.5])!;

    expect(verdict.significatif).toBe(true);
    expect(verdict.verdict).toMatch(/survit à la correction/);
  });

  it('retire la significativité au même résultat obtenu après mille essais', () => {
    // Résultat identique, conclusion opposée — et c'est correct : ce qui
    // change n'est pas la série, c'est ce qu'on a fallu chercher pour la
    // trouver.
    const serie = Array.from({ length: 120 }, (_, i) => (i % 3 === 0 ? -0.004 : 0.006));
    const essais = Array.from({ length: 1000 }, (_, i) => ((i * 37) % 100) / 60 - 0.4);

    const seul = sharpeDeflate(serie, [0.3])!;
    const apresRecherche = sharpeDeflate(serie, essais)!;

    expect(seul.probabilite).toBeGreaterThan(apresRecherche.probabilite);
    expect(apresRecherche.seuilHasard).toBeGreaterThan(seul.seuilHasard);
  });

  it('dit franchement qu’un résultat ne se distingue pas de la chance', () => {
    const faible = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0.004 : -0.0035));
    const essais = Array.from({ length: 500 }, (_, i) => ((i * 17) % 100) / 50 - 0.5);
    const verdict = sharpeDeflate(faible, essais)!;

    expect(verdict.significatif).toBe(false);
    expect(verdict.verdict).toMatch(/ne se distingue pas de la chance/);
  });
});

describe('Monte-Carlo sur l’ordre des trades', () => {
  function trades(resultats: readonly number[]): TradeFerme[] {
    return resultats.map((resultat, index) => ({
      positionId: `p${index}`,
      sens: 'ACHAT' as const,
      quantite: 1,
      ouvertLe: DEBUT + index * H1,
      fermeLe: DEBUT + (index + 1) * H1,
      prixEntree: 1.1,
      prixSortie: 1.1,
      resultat,
      motif: 'TAKE_PROFIT',
    }));
  }

  const serie = [800, -400, 600, -300, 900, -1200, 500, -200, 700, -500, 400, -100];

  it('laisse le résultat final inchangé en permutation, et seulement le chemin varie', () => {
    // Propriété fondatrice de la méthode : réordonner des gains additifs ne
    // change pas leur somme. Ce qui change, c'est le creux traversé.
    const resultat = simulerMonteCarlo({
      trades: trades(serie),
      capitalInitial: 100_000,
      tirages: 500,
      methode: 'PERMUTATION',
      graine: 7,
    })!;

    const totalAttendu = (serie.reduce((t, v) => t + v, 0) / 100_000) * 100;
    expect(resultat.rendementMedianPct).toBeCloseTo(totalAttendu, 6);
    expect(resultat.rendementPercentile5Pct).toBeCloseTo(totalAttendu, 6);
    expect(resultat.drawdownPire).toBeGreaterThan(resultat.drawdownMedian);
  });

  it('fait varier le résultat final en bootstrap', () => {
    const resultat = simulerMonteCarlo({
      trades: trades(serie),
      capitalInitial: 100_000,
      tirages: 500,
      methode: 'BOOTSTRAP',
      graine: 7,
    })!;

    expect(resultat.rendementPercentile95Pct).toBeGreaterThan(resultat.rendementPercentile5Pct);
  });

  it('rend exactement le même résultat pour la même graine', () => {
    const options = {
      trades: trades(serie),
      capitalInitial: 100_000,
      tirages: 300,
      graine: 42,
    } as const;
    const a = simulerMonteCarlo(options)!;
    const b = simulerMonteCarlo(options)!;
    expect(a.drawdownPercentile95).toBe(b.drawdownPercentile95);
  });

  it('détecte un risque de ruine que le backtest n’avait pas montré', () => {
    // Trades énormes par rapport au capital : dans l'ordre d'origine le compte
    // survit, mais un ordonnancement défavorable le vide. C'est exactement ce
    // qu'un chemin unique ne peut pas révéler.
    const risquee = [4000, -3000, 5000, -3500, 3000, -4000, 6000, -3500, 2000, -3000];
    const resultat = simulerMonteCarlo({
      trades: trades(risquee),
      capitalInitial: 10_000,
      tirages: 2000,
      methode: 'BOOTSTRAP',
      graine: 3,
    })!;

    expect(resultat.probabiliteRuine).toBeGreaterThan(0);
    expect(resultat.verdict).toMatch(/ruinent le compte/);
  });

  it('refuse de conclure sur un échantillon minuscule', () => {
    expect(
      simulerMonteCarlo({ trades: trades([100, -50]), capitalInitial: 10_000 }),
    ).toBeNull();
  });
});

describe('walk-forward', () => {
  /** Marche aléatoire déterministe : aucune structure à exploiter. */
  function bruit(nombre: number, graine = 12345): Chandelier[] {
    let etat = graine >>> 0;
    const suivant = () => {
      etat ^= etat << 13;
      etat ^= etat >>> 17;
      etat ^= etat << 5;
      etat >>>= 0;
      return etat / 0x100000000 - 0.5;
    };

    let prix = 1.1;
    return Array.from({ length: nombre }, (_, index) => {
      const ouverture = prix;
      prix += suivant() * 0.002;
      const cloture = prix;
      return {
        horodatage: DEBUT + index * H1,
        ouverture,
        haut: Math.max(ouverture, cloture) + 0.0004,
        bas: Math.min(ouverture, cloture) - 0.0004,
        cloture,
        volume: 1000,
      };
    });
  }

  /** Candidats qui ouvrent au rythme donné, sans aucune logique. */
  function candidatsFactices(cadences: readonly number[]): CandidatWalkForward[] {
    return cadences.map((cadence) => ({
      code: `C${cadence}`,
      nom: `Cadence ${cadence}`,
      fabriquer: () => (vue) => {
        if (vue.positions.length > 0) {
          return vue.index % cadence === 0
            ? { fermetures: vue.positions.map((p) => ({ positionId: p.id })) }
            : {};
        }
        if (vue.ordresEnAttente.length > 0 || vue.index % cadence !== 0) return {};
        return {
          ordres: [{ sens: cadence % 2 === 0 ? 'ACHAT' : 'VENTE', quantite: 0.1 }],
        };
      },
    }));
  }

  it('ne juge jamais sur les données qui ont servi à choisir', () => {
    const rapport = executerWalkForward({
      chandeliers: bruit(1200),
      instrument: EURUSD,
      intervalle: 'H1',
      capitalInitial: 100_000,
      candidats: candidatsFactices([7, 11, 13]),
      fenetreApprentissage: 300,
      fenetreValidation: 150,
    })!;

    expect(rapport.fenetres.length).toBeGreaterThan(1);
    for (const fenetre of rapport.fenetres) {
      // La validation commence après la fin de l'apprentissage : les deux
      // périodes ne se recouvrent jamais.
      expect(fenetre.finValidation).toBeGreaterThan(fenetre.finApprentissage);
      expect(Object.keys(fenetre.scoresApprentissage)).toHaveLength(3);
    }
  });

  it('refuse de crier victoire sur du bruit pur', () => {
    // Le test central. Trois candidats sans avantage, sur une marche
    // aléatoire : le meilleur en apprentissage n'est meilleur que par chance,
    // et la correction pour essais multiples doit le dire.
    const rapport = executerWalkForward({
      chandeliers: bruit(1600, 999),
      instrument: EURUSD,
      intervalle: 'H1',
      capitalInitial: 100_000,
      candidats: candidatsFactices([5, 7, 9, 11, 13]),
      fenetreApprentissage: 300,
      fenetreValidation: 150,
    })!;

    expect(rapport.significativite?.significatif).toBe(false);
    expect(rapport.significativite!.nombreEssais).toBeGreaterThan(5);
  });

  it('compte tous les essais, y compris les perdants', () => {
    // Ne compter que les gagnants sous-estimerait le seuil du hasard : c'est
    // la façon la plus courante de se croire significatif à tort.
    const rapport = executerWalkForward({
      chandeliers: bruit(1200, 4242),
      instrument: EURUSD,
      intervalle: 'H1',
      capitalInitial: 100_000,
      candidats: candidatsFactices([7, 11, 13]),
      fenetreApprentissage: 300,
      fenetreValidation: 150,
    })!;

    // Trois candidats × le nombre de fenêtres : tous les essais sont comptés.
    expect(rapport.significativite!.nombreEssais).toBe(rapport.fenetres.length * 3);
  });

  it('publie l’écart entre apprentissage et validation', () => {
    const rapport = executerWalkForward({
      chandeliers: bruit(1400, 77),
      instrument: EURUSD,
      intervalle: 'H1',
      capitalInitial: 100_000,
      candidats: candidatsFactices([7, 11, 13]),
      fenetreApprentissage: 300,
      fenetreValidation: 150,
    })!;

    expect(rapport.degradation).toBeCloseTo(
      rapport.enEchantillon.rendementPct - rapport.horsEchantillon.rendementPct,
      6,
    );
    expect(rapport.verdict).toMatch(/fenêtre/);
  });

  it('refuse une série trop courte pour être découpée', () => {
    expect(
      executerWalkForward({
        chandeliers: bruit(200),
        instrument: EURUSD,
        intervalle: 'H1',
        capitalInitial: 100_000,
        candidats: candidatsFactices([7]),
        fenetreApprentissage: 300,
        fenetreValidation: 150,
      }),
    ).toBeNull();
  });

  it('refuse de tourner sans candidat', () => {
    expect(
      executerWalkForward({
        chandeliers: bruit(1200),
        instrument: EURUSD,
        intervalle: 'H1',
        capitalInitial: 100_000,
        candidats: [],
        fenetreApprentissage: 300,
        fenetreValidation: 150,
      }),
    ).toBeNull();
  });
});
