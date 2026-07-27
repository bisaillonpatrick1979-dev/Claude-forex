import { describe, expect, it } from 'vitest';

import type { PositionOuverte } from '@/lib/execution/types';
import {
  evaluerGardeFous,
  risqueParLot,
  type DemandeOrdre,
  type EtatRisque,
  type ParametresRisque,
  type PositionAvecInstrument,
} from '@/lib/risque/garde-fous';

import { EURUSD, NAS100, PORTEFEUILLE_NEUF } from '../aides/instruments';

/**
 * Les plafonds vivent ici, pas dans un prompt. Ces tests sont la preuve qu'un
 * agent ne peut pas les contourner en argumentant : la fonction rejette ou
 * réduit, point.
 */

const PARAMETRES: ParametresRisque = {
  risqueMaxParTradePct: 1,
  risqueTotalMaxPct: 5,
  positionsMax: 5,
  partPositionMaxPct: 50,
  partFacteurMaxPct: 50,
  perteJournaliereMaxPct: 3,
  drawdownMaxPct: 15,
  levierMax: 10,
  fenetreEvenementMacroMinutes: 30,
  stopLossObligatoire: true,
};

const MAINTENANT = 1_785_000_000;

function etat(surcharge: Partial<EtatRisque> = {}): EtatRisque {
  return {
    portefeuille: PORTEFEUILLE_NEUF,
    positions: [],
    equiteDebutJournee: 100_000,
    evenementsMacro: [],
    maintenant: MAINTENANT,
    ...surcharge,
  };
}

function demande(surcharge: Partial<DemandeOrdre> = {}): DemandeOrdre {
  return {
    instrument: EURUSD,
    sens: 'ACHAT',
    quantite: 1,
    prixEntree: 1.08,
    stopLoss: 1.075, // 50 points = 500 USD de risque par lot
    tauxCotationVersCompte: 1,
    ...surcharge,
  };
}

function positionOuverte(surcharge: Partial<PositionOuverte> = {}): PositionAvecInstrument {
  return {
    instrument: EURUSD,
    tauxCotationVersCompte: 1,
    prixCourant: 1.08,
    position: {
      id: 'p',
      instrument: 'EURUSD',
      sens: 'ACHAT',
      quantite: 1,
      prixEntree: 1.08,
      stopLoss: 1.075,
      takeProfit: null,
      margeImmobilisee: 10_800,
      commissionTotale: 7,
      swapTotal: 0,
      ouvertLe: MAINTENANT,
      dernierSwapLe: null,
      ...surcharge,
    },
  };
}

describe('refus francs', () => {
  it('rejette un ordre sans stop-loss, sans exception', () => {
    const decision = evaluerGardeFous(demande({ stopLoss: null }), etat(), PARAMETRES);
    expect(decision.decision).toBe('REFUSE');
    expect(decision.quantiteAutorisee).toBe(0);
    expect(decision.raison).toMatch(/stop-loss/i);
  });

  it('rejette un stop placé du mauvais côté de l’entrée', () => {
    const decision = evaluerGardeFous(demande({ stopLoss: 1.09 }), etat(), PARAMETRES);
    expect(decision.decision).toBe('REFUSE');
    expect(decision.controles.some((c) => c.code === 'STOP_INCOHERENT')).toBe(true);
  });

  it('rejette tout quand le portefeuille est gelé', () => {
    const decision = evaluerGardeFous(
      demande(),
      etat({ portefeuille: { ...PORTEFEUILLE_NEUF, gele: true } }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
  });

  it('rejette quand le taux de conversion est inconnu, au lieu de deviner', () => {
    const decision = evaluerGardeFous(
      demande({ tauxCotationVersCompte: null }),
      etat(),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/taux/i);
  });

  it('arrête tout au drawdown maximal depuis le sommet', () => {
    const decision = evaluerGardeFous(
      demande(),
      etat({
        portefeuille: { ...PORTEFEUILLE_NEUF, equite: 84_000, sommetEquite: 100_000 },
        equiteDebutJournee: 84_000,
      }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/intervention manuelle/i);
  });

  it('arrête tout à la perte journalière maximale', () => {
    const decision = evaluerGardeFous(
      demande(),
      etat({
        portefeuille: { ...PORTEFEUILLE_NEUF, equite: 96_900, sommetEquite: 100_000 },
        equiteDebutJournee: 100_000,
      }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/journée/i);
  });

  it('interdit d’ouvrir dans la fenêtre d’un événement macro à fort impact', () => {
    const decision = evaluerGardeFous(
      demande(),
      etat({
        evenementsMacro: [
          { horodatage: MAINTENANT + 15 * 60, impact: 'FORT', libelle: 'Décision BCE' },
        ],
      }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/BCE/);
  });

  it('laisse passer un événement à impact faible', () => {
    const decision = evaluerGardeFous(
      demande(),
      etat({
        evenementsMacro: [
          { horodatage: MAINTENANT + 15 * 60, impact: 'FAIBLE', libelle: 'Stocks pétroliers' },
        ],
      }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('APPROUVE');
  });

  it('refuse au-delà du nombre maximal de positions', () => {
    const decision = evaluerGardeFous(
      demande(),
      etat({ positions: Array.from({ length: 5 }, () => positionOuverte()) }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/maximum 5/);
  });

  it('refuse d’empiler une troisième fois le même pari', () => {
    // Deux longs EUR/USD de 3 lots risquent 1 500 chacun : 3 000 d'exposition
    // nette sur chaque devise, pour un plafond de 50 % du budget (2 500).
    // L'ancien compteur refusait sur le nombre, quelle que soit la taille ;
    // celui-ci refuse sur la charge réelle.
    const decision = evaluerGardeFous(
      demande(),
      etat({
        positions: [
          positionOuverte({ quantite: 3 }),
          positionOuverte({ id: 'p2', quantite: 3 }),
        ],
      }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/concentration/i);
  });

  it('accepte trois fois le même pari quand la charge reste faible', () => {
    // Même configuration, mais 1 lot par position : 1 000 d'exposition nette
    // sur 2 500 autorisés. Le compteur refusait ce cas sans regarder la taille.
    const decision = evaluerGardeFous(
      demande(),
      etat({ positions: [positionOuverte(), positionOuverte({ id: 'p2' })] }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('APPROUVE');
  });

  it('n’a pas d’effet de falaise : des corrélations sous l’ancien seuil s’additionnent', () => {
    // EUR/USD et GBP/USD longs sont corrélés à 0,5 — sous le seuil de 0,70 de
    // l'ancien compteur, qui les voyait donc comme « zéro position corrélée ».
    // Ils partagent pourtant la même jambe short USD, qui s'accumule.
    const gbpusd = { ...EURUSD, code: 'GBPUSD', deviseBase: 'GBP' };
    const decision = evaluerGardeFous(
      demande(),
      etat({
        positions: [
          positionOuverte({ quantite: 3 }),
          {
            ...positionOuverte({ id: 'p2', quantite: 3, instrument: 'GBPUSD' }),
            instrument: gbpusd,
          },
        ],
      }),
      PARAMETRES,
    );

    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/USD/);
  });

  it('autorise une position qui défait la concentration existante', () => {
    // Même portefeuille saturé, mais dans l'autre sens : la vente réduit
    // l'exposition nette au lieu de l'aggraver. Un compteur ne pouvait pas
    // faire cette différence — il ne voyait que « corrélé ».
    const decision = evaluerGardeFous(
      demande({ sens: 'VENTE', stopLoss: 1.085 }),
      etat({
        positions: [
          positionOuverte({ quantite: 3 }),
          positionOuverte({ id: 'p2', quantite: 3 }),
        ],
      }),
      PARAMETRES,
    );

    expect(decision.decision).not.toBe('REFUSE');
  });

  it('accepte une position non corrélée sur une autre classe d’actifs', () => {
    const decision = evaluerGardeFous(
      demande({ instrument: NAS100, prixEntree: 19_500, stopLoss: 19_400 }),
      etat({ positions: [positionOuverte(), positionOuverte({ id: 'p2' })] }),
      PARAMETRES,
    );
    expect(decision.decision).not.toBe('REFUSE');
  });
});

describe('réductions de taille', () => {
  it('réduit au lieu de refuser quand le risque par trade est dépassé', () => {
    // 500 USD de risque par lot ; 1 % de 100 000 = 1000 USD → 2 lots maximum.
    const decision = evaluerGardeFous(demande({ quantite: 10 }), etat(), PARAMETRES);

    expect(decision.decision).toBe('REDUIT');
    expect(decision.quantiteAutorisee).toBeCloseTo(2, 6);
    expect(decision.risqueEstimePct).toBeCloseTo(1, 6);
  });

  it('tient compte du risque déjà engagé sur les positions ouvertes', () => {
    // Une position ouverte risquant 500 USD, plafond total 5 % = 5000 USD.
    const decision = evaluerGardeFous(
      demande({ quantite: 100, instrument: NAS100, prixEntree: 19_500, stopLoss: 19_400 }),
      etat({ positions: [positionOuverte()] }),
      PARAMETRES,
    );

    expect(decision.decision).toBe('REDUIT');
    const controle = decision.controles.find((c) => c.code === 'RISQUE_TOTAL');
    expect(controle).toBeDefined();
    // Risque total après réduction : au plus 5 % de l'équité.
    expect(decision.risqueEstimePct!).toBeLessThanOrEqual(5);
  });

  it('plafonne le levier à la limite maison', () => {
    // Sans contrainte de risque : stop très proche, donc le levier mord en premier.
    const decision = evaluerGardeFous(
      demande({ quantite: 50, stopLoss: 1.0799 }),
      etat(),
      PARAMETRES,
    );

    const levier = decision.controles.find((c) => c.code === 'LEVIER');
    expect(levier).toBeDefined();
    // 10:1 sur 100 000 USD = 1 000 000 de notionnel, soit ~9,25 lots à 1.08.
    expect(decision.quantiteAutorisee).toBeLessThanOrEqual(9.26);
  });

  it('arrondit la taille vers le bas, jamais vers le haut', () => {
    const decision = evaluerGardeFous(demande({ quantite: 10 }), etat(), PARAMETRES);
    const centiemes = decision.quantiteAutorisee * 100;
    expect(Number.isInteger(Math.round(centiemes))).toBe(true);
    expect(decision.quantiteAutorisee * 500).toBeLessThanOrEqual(1000 + 1e-9);
  });

  it('refuse quand la taille autorisée tombe sous le lot minimal', () => {
    const decision = evaluerGardeFous(
      demande({ quantite: 10 }),
      etat({
        portefeuille: { ...PORTEFEUILLE_NEUF, equite: 100, solde: 100, sommetEquite: 100 },
        equiteDebutJournee: 100,
      }),
      PARAMETRES,
    );
    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/taille autorisée/i);
  });
});

describe('cas nominal', () => {
  it('approuve un ordre conforme et chiffre le risque', () => {
    const decision = evaluerGardeFous(demande({ quantite: 1 }), etat(), PARAMETRES);

    expect(decision.decision).toBe('APPROUVE');
    expect(decision.quantiteAutorisee).toBe(1);
    expect(decision.risqueEstimePct).toBeCloseTo(0.5, 6);
    expect(decision.controles.every((c) => c.statut === 'OK')).toBe(true);
  });

  it('calcule le risque par lot depuis la distance au stop', () => {
    expect(risqueParLot(EURUSD, 1.08, 1.075, 1)).toBeCloseTo(500, 6);
    // Sur un compte en USD, une paire cotée en JPY passe par le taux.
    expect(risqueParLot(EURUSD, 1.08, 1.075, 1 / 150)).toBeCloseTo(500 / 150, 6);
  });

  it('journalise chaque contrôle, y compris ceux qui passent', () => {
    const decision = evaluerGardeFous(demande(), etat(), PARAMETRES);
    const codes = decision.controles.map((c) => c.code);
    expect(codes).toContain('DRAWDOWN');
    expect(codes).toContain('PERTE_JOURNALIERE');
    expect(codes).toContain('EVENEMENT_MACRO');
    expect(codes).toContain('POSITIONS_MAX');
    expect(codes).toContain('CONCENTRATION');
    expect(codes).toContain('RISQUE_TRADE');
    expect(codes).toContain('LEVIER');
  });
});
