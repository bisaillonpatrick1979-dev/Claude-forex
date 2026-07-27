import { describe, expect, it } from 'vitest';

import { correlationMesuree, rendementsLog } from '@/lib/risque/correlation';
import {
  evaluerBudgetRisque,
  risqueAgrege,
  type PositionRisquee,
  type SourceCorrelation,
} from '@/lib/risque/portefeuille';

/**
 * Ce que ces tests protègent.
 *
 * La somme naïve majore toujours le risque réel — c'est une conséquence de
 * l'inégalité triangulaire, et un test le vérifie explicitement. Elle n'est
 * donc pas dangereuse au sens où elle laisserait passer trop. Son défaut est
 * qu'elle **ne distingue rien** : même facture pour une couverture parfaite et
 * pour un pari doublé, et aucune indication de quelle position porte le risque.
 *
 * Le trou de sécurité, lui, était dans le compteur de positions corrélées :
 * trois positions à 0,69 sous un seuil de 0,70 comptaient pour zéro.
 */

function position(instrument: string, sens: 'ACHAT' | 'VENTE', risque: number): PositionRisquee {
  return { instrument, sens, risque };
}

/** Matrice explicite, pour que chaque test dise exactement ce qu'il suppose. */
function matrice(valeurs: Readonly<Record<string, number>>): SourceCorrelation {
  return (a, b) => {
    if (a === b) return 1;
    return valeurs[`${a}|${b}`] ?? valeurs[`${b}|${a}`] ?? 0;
  };
}

describe('agrégation du risque', () => {
  it('additionne exactement deux positions parfaitement corrélées', () => {
    // Deux fois le même pari : aucune diversification, le risque est la somme.
    const agrege = risqueAgrege(
      [position('EURUSD', 'ACHAT', 1000), position('GBPUSD', 'ACHAT', 1000)],
      matrice({ 'EURUSD|GBPUSD': 1 }),
    );

    expect(agrege.risqueSomme).toBe(2000);
    expect(agrege.risqueEffectif).toBeCloseTo(2000, 6);
    expect(agrege.ratioDiversification).toBeCloseTo(1, 6);
  });

  it('annule le risque d’une couverture parfaite', () => {
    // Le cas que la somme naïve rate le plus gravement : elle compte 2 000 de
    // risque là où il n'y en a aucun, et refuse donc des positions gratuites.
    const agrege = risqueAgrege(
      [position('EURUSD', 'ACHAT', 1000), position('EURUSD', 'VENTE', 1000)],
      matrice({}),
    );

    expect(agrege.risqueSomme).toBe(2000);
    expect(agrege.risqueEffectif).toBeCloseTo(0, 6);
  });

  it('rend √2 fois le risque unitaire sur deux positions décorrélées', () => {
    // Le résultat classique : la diversification réduit le risque d'un facteur
    // √n, pas de n.
    const agrege = risqueAgrege(
      [position('EURUSD', 'ACHAT', 1000), position('NAS100', 'ACHAT', 1000)],
      matrice({}),
    );

    expect(agrege.risqueEffectif).toBeCloseTo(1000 * Math.SQRT2, 6);
    expect(agrege.ratioDiversification).toBeCloseTo(Math.SQRT2 / 2, 6);
  });

  it('traite deux ventes corrélées comme additives, pas comme une couverture', () => {
    // Piège classique : le signe s'applique deux fois si on n'y prend pas
    // garde. Deux shorts sur des instruments corrélés, c'est le même pari.
    const agrege = risqueAgrege(
      [position('EURUSD', 'VENTE', 1000), position('GBPUSD', 'VENTE', 1000)],
      matrice({ 'EURUSD|GBPUSD': 1 }),
    );

    expect(agrege.risqueEffectif).toBeCloseTo(2000, 6);
  });

  it('reconnaît une couverture entre instruments corrélés de sens opposés', () => {
    const agrege = risqueAgrege(
      [position('EURUSD', 'ACHAT', 1000), position('GBPUSD', 'VENTE', 1000)],
      matrice({ 'EURUSD|GBPUSD': 0.9 }),
    );

    expect(agrege.risqueEffectif).toBeLessThan(700);
    expect(agrege.ratioDiversification).toBeLessThan(0.35);
  });

  it('ne rend jamais un ratio de diversification supérieur à 1', () => {
    const agrege = risqueAgrege(
      [
        position('EURUSD', 'ACHAT', 900),
        position('GBPUSD', 'ACHAT', 800),
        position('XAUUSD', 'ACHAT', 700),
      ],
      matrice({ 'EURUSD|GBPUSD': 1, 'EURUSD|XAUUSD': 1, 'GBPUSD|XAUUSD': 1 }),
    );
    expect(agrege.ratioDiversification).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('rend zéro sur un portefeuille vide', () => {
    const agrege = risqueAgrege([], matrice({}));
    expect(agrege.risqueEffectif).toBe(0);
    expect(agrege.contributions).toHaveLength(0);
  });
});

describe('contributions marginales', () => {
  it('somme exactement au risque agrégé', () => {
    // Propriété mathématique de la décomposition : si elle n'est pas vérifiée,
    // les parts affichées ne veulent rien dire.
    const agrege = risqueAgrege(
      [
        position('EURUSD', 'ACHAT', 1200),
        position('GBPUSD', 'ACHAT', 800),
        position('USDJPY', 'VENTE', 500),
      ],
      matrice({ 'EURUSD|GBPUSD': 0.85, 'EURUSD|USDJPY': -0.4, 'GBPUSD|USDJPY': -0.3 }),
    );

    const somme = agrege.contributions.reduce((total, c) => total + c.contribution, 0);
    expect(somme).toBeCloseTo(agrege.risqueEffectif, 6);
  });

  it('impute plus de risque à la position corrélée au reste qu’à l’isolée', () => {
    // Deux positions de taille identique : celle qui double un pari existant
    // porte plus de risque que celle qui n'a rien à voir avec le reste.
    const agrege = risqueAgrege(
      [
        position('EURUSD', 'ACHAT', 1000),
        position('GBPUSD', 'ACHAT', 1000),
        position('NAS100', 'ACHAT', 1000),
      ],
      matrice({ 'EURUSD|GBPUSD': 0.9 }),
    );

    const parInstrument = new Map(agrege.contributions.map((c) => [c.instrument, c.contribution]));
    expect(parInstrument.get('EURUSD')!).toBeGreaterThan(parInstrument.get('NAS100')!);
  });

  it('rend une contribution négative pour une position qui couvre', () => {
    // Une couverture retire du risque : sa contribution doit être négative,
    // pas simplement petite.
    const agrege = risqueAgrege(
      [
        position('EURUSD', 'ACHAT', 2000),
        position('GBPUSD', 'ACHAT', 2000),
        position('EURUSD', 'VENTE', 800),
      ],
      matrice({ 'EURUSD|GBPUSD': 0.9 }),
    );

    const couverture = agrege.contributions.find(
      (c) => c.instrument === 'EURUSD' && c.sens === 'VENTE',
    )!;
    expect(couverture.contribution).toBeLessThan(0);
  });
});

describe('budget de risque', () => {
  const budget = 3000;

  it('autorise davantage qu’une somme naïve quand la position couvre', () => {
    // Le cas décisif. Somme naïve : 2 800 engagés sur 3 000, il reste 200.
    // Réalité : la nouvelle position réduit le risque, on peut en prendre bien
    // plus. Refuser ici serait refuser une amélioration du portefeuille.
    const ouvertes = [position('EURUSD', 'ACHAT', 1400), position('GBPUSD', 'ACHAT', 1400)];
    const correlation = matrice({ 'EURUSD|GBPUSD': 0.95 });

    const sommeNaive = 2800;
    const decision = evaluerBudgetRisque(
      ouvertes,
      { instrument: 'EURUSD', sens: 'VENTE' },
      budget,
      correlation,
    );

    expect(decision.refuse).toBe(false);
    expect(decision.risqueAutorise).toBeGreaterThan(budget - sommeNaive);
    expect(decision.explication).toMatch(/couvre partiellement/);
  });

  it('n’accorde presque rien de plus que la somme naïve quand la position double le pari', () => {
    // Le symétrique du cas précédent. À 0,95 de corrélation dans le même sens,
    // la diversification est marginale : l'agrégat reste proche de la somme, et
    // la marge accordée aussi. Le contraste avec la couverture est ce qui
    // compte — même corrélation, même budget, réponses opposées.
    const ouvertes = [position('EURUSD', 'ACHAT', 1400), position('GBPUSD', 'ACHAT', 1400)];
    const correlation = matrice({ 'EURUSD|GBPUSD': 0.95 });

    const memeSens = evaluerBudgetRisque(
      ouvertes,
      { instrument: 'EURUSD', sens: 'ACHAT' },
      budget,
      correlation,
    );
    const couverture = evaluerBudgetRisque(
      ouvertes,
      { instrument: 'EURUSD', sens: 'VENTE' },
      budget,
      correlation,
    );

    expect(memeSens.risqueAutorise).toBeLessThan(300);
    expect(couverture.risqueAutorise).toBeGreaterThan(memeSens.risqueAutorise * 5);
    expect(memeSens.explication).toMatch(/doubler le pari/);
  });

  it('majore toujours le risque réel par la somme naïve', () => {
    // Propriété qui découle de l'inégalité triangulaire, et qui dit pourquoi
    // l'ancienne somme n'était pas dangereuse mais aveugle : elle ne peut que
    // surestimer, jamais laisser passer trop.
    const cas: readonly (readonly [number, PositionRisquee[]])[] = [
      [1, [position('A', 'ACHAT', 900), position('B', 'ACHAT', 700)]],
      [-1, [position('A', 'ACHAT', 900), position('B', 'VENTE', 700)]],
      [0.3, [position('A', 'VENTE', 500), position('B', 'VENTE', 500)]],
    ];

    for (const [rho, positions] of cas) {
      const agrege = risqueAgrege(positions, matrice({ 'A|B': rho }));
      expect(agrege.risqueEffectif).toBeLessThanOrEqual(agrege.risqueSomme + 1e-9);
    }
  });

  it('respecte exactement le budget après ouverture', () => {
    // La taille rendue doit saturer le budget, ni plus ni moins : c'est ce qui
    // distingue une résolution d'un plafonnement approximatif.
    const ouvertes = [position('EURUSD', 'ACHAT', 1000)];
    const decision = evaluerBudgetRisque(
      ouvertes,
      { instrument: 'NAS100', sens: 'ACHAT' },
      budget,
      matrice({}),
    );

    expect(decision.risqueApres).toBeCloseTo(budget, 6);
  });

  it('refuse quand le budget est déjà consommé', () => {
    const ouvertes = [position('EURUSD', 'ACHAT', 2000), position('GBPUSD', 'ACHAT', 2000)];
    const decision = evaluerBudgetRisque(
      ouvertes,
      { instrument: 'XAUUSD', sens: 'ACHAT' },
      budget,
      matrice({ 'EURUSD|GBPUSD': 1 }),
    );

    expect(decision.refuse).toBe(true);
    expect(decision.explication).toMatch(/déjà consommé/);
  });

  it('signale que la diversification n’apporte rien quand tout est corrélé', () => {
    const ouvertes = [position('EURUSD', 'ACHAT', 1600), position('GBPUSD', 'ACHAT', 1600)];
    const decision = evaluerBudgetRisque(
      ouvertes,
      { instrument: 'XAUUSD', sens: 'ACHAT' },
      budget,
      matrice({ 'EURUSD|GBPUSD': 1 }),
    );

    expect(decision.explication).toMatch(/même pari/);
  });

  it('refuse tout quand le budget est nul', () => {
    const decision = evaluerBudgetRisque([], { instrument: 'EURUSD', sens: 'ACHAT' }, 0, matrice({}));
    expect(decision.refuse).toBe(true);
  });

  it('donne le budget entier sur un portefeuille vide', () => {
    const decision = evaluerBudgetRisque(
      [],
      { instrument: 'EURUSD', sens: 'ACHAT' },
      budget,
      matrice({}),
    );
    expect(decision.risqueAutorise).toBeCloseTo(budget, 6);
  });
});

describe('corrélation mesurée', () => {
  it('rend 1 sur deux séries identiques', () => {
    const serie = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 0.01);
    expect(correlationMesuree(serie, serie)).toBeCloseTo(1, 9);
  });

  it('rend −1 sur deux séries opposées', () => {
    const serie = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 0.01);
    expect(correlationMesuree(serie, serie.map((v) => -v))).toBeCloseTo(-1, 9);
  });

  it('refuse de conclure sur un échantillon trop court', () => {
    // Un zéro serait lu comme « décorrélé » et autoriserait deux fois le même
    // pari. Le null force l'appelant à retomber sur l'heuristique.
    expect(correlationMesuree([0.01, -0.01, 0.02], [0.01, 0.01, -0.02])).toBeNull();
  });

  it('refuse de conclure quand une série ne bouge pas', () => {
    const plate = Array(60).fill(0);
    const mobile = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.01 : -0.01));
    expect(correlationMesuree(plate, mobile)).toBeNull();
  });

  it('aligne deux séries de longueurs différentes par la fin', () => {
    // Les bougies récentes comptent ; une corrélation d'il y a trois ans ne dit
    // rien du régime actuel.
    const longue = Array.from({ length: 200 }, (_, i) => Math.sin(i / 7) * 0.01);
    const courte = longue.slice(-80);
    expect(correlationMesuree(longue, courte)).toBeCloseTo(1, 9);
  });

  it('reste dans [-1, 1] malgré les arrondis', () => {
    const serie = Array.from({ length: 100 }, (_, i) => i * 1e-9);
    const valeur = correlationMesuree(serie, serie);
    expect(valeur).not.toBeNull();
    expect(Math.abs(valeur!)).toBeLessThanOrEqual(1);
  });
});

describe('rendements logarithmiques', () => {
  it('rend un élément de moins que la série de prix', () => {
    expect(rendementsLog([100, 101, 102, 103])).toHaveLength(3);
  });

  it('écarte les prix nuls ou négatifs au lieu de produire des infinis', () => {
    const rendements = rendementsLog([100, 0, 102, 103]);
    expect(rendements.every(Number.isFinite)).toBe(true);
  });
});
