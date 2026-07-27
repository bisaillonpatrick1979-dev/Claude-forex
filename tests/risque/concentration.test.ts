import { describe, expect, it } from 'vitest';

import {
  analyserConcentration,
  evaluerConcentration,
  facteursInstrument,
  sourceFacteurs,
  type InstrumentFacteurs,
  type LimitesConcentration,
} from '@/lib/risque/concentration';
import { correlationInstruments } from '@/lib/risque/correlation';
import { risqueAgrege, type PositionRisquee, type SourceCorrelation } from '@/lib/risque/portefeuille';

/**
 * Ce que le compteur de positions corrélées ne pouvait pas faire.
 *
 * Il comptait les couples au-dessus d'un seuil. Ces tests fixent les deux
 * comportements qui manquaient : pas de falaise autour du seuil, et détection
 * des chaînes où aucun couple ne dépasse le seuil alors que l'ensemble forme
 * un seul pari.
 */

const INSTRUMENTS: InstrumentFacteurs[] = [
  { code: 'EURUSD', classeActif: 'FOREX', deviseBase: 'EUR', deviseCotation: 'USD' },
  { code: 'GBPUSD', classeActif: 'FOREX', deviseBase: 'GBP', deviseCotation: 'USD' },
  { code: 'USDCHF', classeActif: 'FOREX', deviseBase: 'USD', deviseCotation: 'CHF' },
  { code: 'AUDJPY', classeActif: 'FOREX', deviseBase: 'AUD', deviseCotation: 'JPY' },
  { code: 'XAUUSD', classeActif: 'MATIERE_PREMIERE', deviseBase: 'XAU', deviseCotation: 'USD' },
  { code: 'NAS100', classeActif: 'INDICE', deviseBase: null, deviseCotation: 'USD' },
  { code: 'SPX500', classeActif: 'INDICE', deviseBase: null, deviseCotation: 'USD' },
];

const FACTEURS = sourceFacteurs(INSTRUMENTS);

const TABLE = new Map(INSTRUMENTS.map((instrument) => [instrument.code, instrument]));

const CORRELATION: SourceCorrelation = (a, b) => {
  const gauche = TABLE.get(a);
  const droite = TABLE.get(b);
  if (!gauche || !droite) return 0;
  return correlationInstruments(exposer(gauche), exposer(droite));
};

/** `correlationInstruments` attend `instrument`, pas `code` : mal nommer le
 *  champ ferait passer deux paires distinctes pour le même instrument. */
function exposer(instrument: InstrumentFacteurs) {
  return {
    instrument: instrument.code,
    classeActif: instrument.classeActif,
    deviseBase: instrument.deviseBase,
    deviseCotation: instrument.deviseCotation,
  };
}

function position(instrument: string, sens: 'ACHAT' | 'VENTE', risque: number): PositionRisquee {
  return { instrument, sens, risque };
}

const LIMITES: LimitesConcentration = { partPositionMaxPct: 50, partFacteurMaxPct: 50 };

describe('décomposition en facteurs', () => {
  it('sépare une paire Forex en ses deux jambes de devise', () => {
    expect(facteursInstrument(TABLE.get('EURUSD')!)).toEqual([
      { facteur: 'EUR', poids: 1 },
      { facteur: 'USD', poids: -1 },
    ]);
  });

  it('traite l’or comme un facteur propre, financé en dollar', () => {
    expect(facteursInstrument(TABLE.get('XAUUSD')!)).toEqual([
      { facteur: 'XAU', poids: 1 },
      { facteur: 'USD', poids: -1 },
    ]);
  });

  it('rabat les instruments sans devise de base sur leur classe d’actif', () => {
    expect(facteursInstrument(TABLE.get('NAS100')!)).toEqual([{ facteur: 'INDICE', poids: 1 }]);
    // Volontaire : deux indices sont le même facteur, parce qu'ils sont
    // essentiellement le même pari.
    expect(facteursInstrument(TABLE.get('SPX500')!)).toEqual([{ facteur: 'INDICE', poids: 1 }]);
  });
});

describe('analyse de concentration', () => {
  it('voit une chaîne short USD que le comptage par couples manquait', () => {
    // Aucun couple n'atteint 0,70 : EUR/USD contre GBP/USD vaut 0,5, contre
    // USD/CHF −0,5. L'ancien compteur voyait « zéro position corrélée ».
    expect(CORRELATION('EURUSD', 'GBPUSD')).toBeLessThan(0.7);

    const analyse = analyserConcentration(
      [
        position('EURUSD', 'ACHAT', 1000),
        position('GBPUSD', 'ACHAT', 1000),
        position('USDCHF', 'VENTE', 1000),
      ],
      CORRELATION,
      FACTEURS,
    );

    const dominant = analyse.facteurs[0]!;
    expect(dominant.facteur).toBe('USD');
    expect(dominant.expositionNette).toBeCloseTo(-3000, 6);
    // Trois positions, mais une seule direction : le net vaut le brut.
    expect(dominant.expositionBrute).toBeCloseTo(3000, 6);
  });

  it('annule l’exposition quand les jambes se compensent', () => {
    const analyse = analyserConcentration(
      [position('EURUSD', 'ACHAT', 1000), position('GBPUSD', 'VENTE', 1000)],
      CORRELATION,
      FACTEURS,
    );

    const usd = analyse.facteurs.find((entree) => entree.facteur === 'USD')!;
    expect(usd.expositionNette).toBeCloseTo(0, 6);
    expect(usd.expositionBrute).toBeCloseTo(2000, 6);
  });

  it('compte les paris effectifs sans falaise autour de l’ancien seuil', () => {
    // Trois positions équipondérées, corrélées à 0,69 : sous un seuil de 0,70
    // le compteur affichait zéro. La mesure continue en voit 1,26 — presque un
    // seul pari, ce qu'elles sont.
    const troisPositions = [
      position('A', 'ACHAT', 1000),
      position('B', 'ACHAT', 1000),
      position('C', 'ACHAT', 1000),
    ];
    const rho069: SourceCorrelation = (a, b) => (a === b ? 1 : 0.69);

    const serree = analyserConcentration(troisPositions, rho069, () => []);
    expect(serree.parisEffectifs).toBeCloseTo(1.26, 2);

    const independantes = analyserConcentration(
      troisPositions,
      (a, b) => (a === b ? 1 : 0),
      () => [],
    );
    expect(independantes.parisEffectifs).toBeCloseTo(3, 6);
  });

  it('ne confond pas répartition des contributions et diversification', () => {
    // Piège classique : un Herfindahl sur les contributions donne exactement 3
    // dans les deux cas ci-dessus, parce que trois positions symétriques
    // portent un tiers du risque chacune quelle que soit leur corrélation.
    const troisPositions = [
      position('A', 'ACHAT', 1000),
      position('B', 'ACHAT', 1000),
      position('C', 'ACHAT', 1000),
    ];

    for (const rho of [0, 0.69, 1]) {
      const analyse = analyserConcentration(
        troisPositions,
        (a, b) => (a === b ? 1 : rho),
        () => [],
      );
      expect(analyse.partPositionMaxPct).toBeCloseTo(100 / 3, 6);
    }
  });
});

describe('plafond par facteur', () => {
  const budget = 5000; // plafond par facteur : 2 500

  it('refuse d’ajouter à un facteur déjà saturé', () => {
    const decision = evaluerConcentration(
      [position('EURUSD', 'ACHAT', 2000), position('GBPUSD', 'ACHAT', 1000)],
      { instrument: 'EURUSD', sens: 'ACHAT' },
      budget,
      LIMITES,
      CORRELATION,
      FACTEURS,
    );

    expect(decision.refuse).toBe(true);
    expect(decision.contrainte).toBe('FACTEUR');
    expect(decision.facteurLimitant).toBe('USD');
    expect(decision.explication).toMatch(/USD/);
  });

  it('élargit le plafond quand la position défait la concentration', () => {
    // Même portefeuille, sens opposé : la vente réduit le short USD, donc le
    // plafond n'est pas 2 500 − 3 000 mais 2 500 + 3 000.
    const decision = evaluerConcentration(
      [position('EURUSD', 'ACHAT', 2000), position('GBPUSD', 'ACHAT', 1000)],
      { instrument: 'EURUSD', sens: 'VENTE' },
      budget,
      LIMITES,
      CORRELATION,
      FACTEURS,
    );

    expect(decision.refuse).toBe(false);
    expect(decision.risqueAutorise).toBeGreaterThan(2500);
  });

  it('laisse passer un facteur indépendant à portefeuille chargé', () => {
    const decision = evaluerConcentration(
      [position('EURUSD', 'ACHAT', 2000), position('GBPUSD', 'ACHAT', 1000)],
      { instrument: 'NAS100', sens: 'ACHAT' },
      budget,
      LIMITES,
      CORRELATION,
      FACTEURS,
    );

    expect(decision.refuse).toBe(false);
    expect(decision.risqueAutorise).toBeCloseTo(2500, 6);
  });

  it('signale un facteur en dépassement que la position ne touche pas', () => {
    const decision = evaluerConcentration(
      [position('EURUSD', 'ACHAT', 2000), position('GBPUSD', 'ACHAT', 1000)],
      { instrument: 'AUDJPY', sens: 'ACHAT' },
      budget,
      LIMITES,
      CORRELATION,
      FACTEURS,
    );

    expect(decision.refuse).toBe(false);
    expect(decision.explication).toMatch(/USD.*n’y touche pas/);
  });
});

describe('plafond par position', () => {
  const budget = 1e9; // hors jeu : on isole la contrainte de part

  it('ne s’applique pas à la première position', () => {
    const decision = evaluerConcentration(
      [],
      { instrument: 'EURUSD', sens: 'ACHAT' },
      budget,
      LIMITES,
      CORRELATION,
      FACTEURS,
    );
    expect(decision.refuse).toBe(false);
    expect(decision.risqueAutorise).toBeGreaterThan(0);
  });

  it('accorde exactement la parité face à une position existante', () => {
    // Un plafond de 50 % avec une seule position ouverte de 1 000 autorise
    // exactement 1 000 : les deux portent alors la moitié du risque.
    const decision = evaluerConcentration(
      [position('NAS100', 'ACHAT', 1000)],
      { instrument: 'AUDJPY', sens: 'ACHAT' },
      budget,
      LIMITES,
      (a, b) => (a === b ? 1 : 0),
      FACTEURS,
    );

    expect(decision.contrainte).toBe('POSITION');
    expect(decision.risqueAutorise).toBeCloseTo(1000, 6);
  });

  it('tient le plafond promis : la part obtenue vaut exactement la limite', () => {
    const ouvertes = [position('NAS100', 'ACHAT', 1000), position('AUDJPY', 'ACHAT', 400)];
    const correlation: SourceCorrelation = (a, b) => (a === b ? 1 : 0.3);
    const limites: LimitesConcentration = { partPositionMaxPct: 40, partFacteurMaxPct: 100 };

    const decision = evaluerConcentration(
      ouvertes,
      { instrument: 'SPX500', sens: 'ACHAT' },
      budget,
      limites,
      correlation,
      FACTEURS,
    );

    const apres = risqueAgrege(
      [...ouvertes, position('SPX500', 'ACHAT', decision.risqueAutorise)],
      correlation,
    );

    const nouvelle = apres.contributions.find((entree) => entree.instrument === 'SPX500')!;
    expect(nouvelle.partPct).toBeCloseTo(40, 6);
  });

  it('ne redimensionne pas l’existant, et le dit', () => {
    // Conséquence assumée du dimensionnement à l'ouverture : une position déjà
    // en place peut rester au-dessus du plafond après l'ajout d'une autre. Le
    // plafond borne ce qu'on ouvre, pas ce qui est ouvert — et l'analyse
    // publie la part réelle pour que le dépassement soit visible plutôt que
    // masqué par un « conforme ».
    const ouvertes = [position('NAS100', 'ACHAT', 1000), position('AUDJPY', 'ACHAT', 400)];
    const correlation: SourceCorrelation = (a, b) => (a === b ? 1 : 0.3);
    const limites: LimitesConcentration = { partPositionMaxPct: 40, partFacteurMaxPct: 100 };

    const decision = evaluerConcentration(
      ouvertes,
      { instrument: 'SPX500', sens: 'ACHAT' },
      budget,
      limites,
      correlation,
      FACTEURS,
    );

    const apres = analyserConcentration(
      [...ouvertes, position('SPX500', 'ACHAT', decision.risqueAutorise)],
      correlation,
      FACTEURS,
    );

    expect(apres.positionDominante).toBe('NAS100');
    expect(apres.partPositionMaxPct).toBeGreaterThan(40);
  });

  it('resserre le plafond quand la nouvelle position est corrélée', () => {
    const isolee = evaluerConcentration(
      [position('NAS100', 'ACHAT', 1000)],
      { instrument: 'AUDJPY', sens: 'ACHAT' },
      budget,
      LIMITES,
      (a, b) => (a === b ? 1 : 0),
      FACTEURS,
    );

    const jumelle = evaluerConcentration(
      [position('NAS100', 'ACHAT', 1000)],
      { instrument: 'AUDJPY', sens: 'ACHAT' },
      budget,
      { partPositionMaxPct: 40, partFacteurMaxPct: 100 },
      (a, b) => (a === b ? 1 : 0),
      FACTEURS,
    );

    expect(jumelle.risqueAutorise).toBeLessThan(isolee.risqueAutorise);
  });
});
