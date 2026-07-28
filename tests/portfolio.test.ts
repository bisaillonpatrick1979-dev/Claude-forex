import { describe, expect, it } from 'vitest';

import { d } from '@/lib/decimal';
import {
  DEFAULT_CONFIG,
  configWarnings,
  deriveLimits,
  drawdownPct,
  sanitizeConfig,
} from '@/lib/portfolioMath';
import type { PortfolioConfig } from '@/types/portfolio';

const config = (patch: Partial<PortfolioConfig> = {}): PortfolioConfig => ({
  ...DEFAULT_CONFIG,
  ...patch,
});

/**
 * Ces limites sont ce qui sépare une perte contenue d'une perte subie. Les
 * tester sur des chiffres ronds rend la faute évidente quand elle arrive.
 */

describe('capital confié à l’IA', () => {
  it('calcule l’enveloppe à partir du pourcentage', () => {
    const limites = deriveLimits(config({ totalCapital: '100000', aiAllocationPct: 10 }));
    expect(limites.aiCapital.versTexte(2)).toBe('10000.00');
  });

  it('fait porter les pourcentages sur l’enveloppe, pas sur le compte', () => {
    // Le point qui compte : confier 10 000 sur 100 000 puis risquer « 2 % »
    // doit vouloir dire 200, pas 2 000.
    const limites = deriveLimits(
      config({ totalCapital: '100000', aiAllocationPct: 10, maxTradePct: 2, maxTradeAmount: '999999' }),
    );
    expect(limites.pctCap.versTexte(2)).toBe('200.00');
  });

  it('rend une enveloppe nulle quand rien n’est confié', () => {
    const limites = deriveLimits(config({ aiAllocationPct: 0 }));
    expect(limites.aiCapital.estZero()).toBe(true);
    expect(limites.maxTradeValue.estZero()).toBe(true);
  });
});

describe('plafond par trade', () => {
  it('retient le plus strict des deux plafonds', () => {
    // Un plafond en dollars et un plafond en pourcentage se cumulent : sinon
    // régler l'un annulerait silencieusement l'autre.
    const parMontant = deriveLimits(
      config({ totalCapital: '100000', aiAllocationPct: 10, maxTradePct: 5, maxTradeAmount: '300' }),
    );
    expect(parMontant.maxTradeValue.versTexte(2)).toBe('300.00');

    const parPourcentage = deriveLimits(
      config({ totalCapital: '100000', aiAllocationPct: 10, maxTradePct: 1, maxTradeAmount: '5000' }),
    );
    expect(parPourcentage.maxTradeValue.versTexte(2)).toBe('100.00');
  });

  it('dit lequel des deux plafonds mord', () => {
    // Sans cette indication, régler le plafond qui ne sert à rien donne
    // l'impression que le réglage est ignoré.
    expect(
      configWarnings(config({ maxTradePct: 5, maxTradeAmount: '300' })),
    ).toContain('absolute-cap-binds');
    expect(
      configWarnings(config({ maxTradePct: 1, maxTradeAmount: '5000' })),
    ).toContain('pct-cap-binds');
  });
});

describe('coûts', () => {
  it('compte les frais à l’entrée ET à la sortie', () => {
    // Ignorer la moitié du coût flatterait chaque backtest.
    const limites = deriveLimits(
      config({
        totalCapital: '100000',
        aiAllocationPct: 100,
        maxTradePct: 100,
        maxTradeAmount: '10000',
        feeBps: 10,
        slippageBps: 5,
      }),
    );
    // 15 bps sur 10 000 = 15 $, doublé pour l'aller-retour.
    expect(limites.roundTripCost.versTexte(2)).toBe('30.00');
  });

  it('refuse de laisser passer des coûts nuls sans le dire', () => {
    expect(configWarnings(config({ feeBps: 0, slippageBps: 0 }))).toContain('zero-costs');
  });

  it('signale des coûts qui mangent le trade', () => {
    expect(configWarnings(config({ feeBps: 100, slippageBps: 100 }))).toContain('cost-heavy');
  });

  it('n’a pas de coûts nuls par défaut', () => {
    // Une valeur par défaut à zéro est le moyen le plus sûr de produire un
    // backtest mensonger sans que personne ne l'ait décidé.
    expect(DEFAULT_CONFIG.feeBps).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.slippageBps).toBeGreaterThan(0);
  });
});

describe('bornage des réglages', () => {
  it('ramène un pourcentage aberrant dans ses bornes', () => {
    const sain = sanitizeConfig(config({ aiAllocationPct: 500, maxDrawdownPct: -10 }));
    expect(sain.aiAllocationPct).toBe(100);
    expect(sain.maxDrawdownPct).toBe(1);
  });

  it('refuse un capital négatif sans faire échouer la saisie', () => {
    expect(sanitizeConfig(config({ totalCapital: '-5000' })).totalCapital).toBe('0.00');
  });

  it('survit à une saisie illisible', () => {
    // L'utilisateur tape, efface, retape : un champ vide ne doit pas casser
    // l'application le temps d'une frappe.
    expect(sanitizeConfig(config({ totalCapital: '' })).totalCapital).toBe('0.00');
    expect(sanitizeConfig(config({ maxTradeAmount: 'abc' })).maxTradeAmount).toBe('0.00');
  });

  it('arrondit les compteurs entiers', () => {
    expect(sanitizeConfig(config({ maxOpenPositions: 3.7 })).maxOpenPositions).toBe(4);
  });
});

describe('perte journalière', () => {
  it('signale une limite plus petite qu’un seul trade', () => {
    // Une position perdante suffirait alors à arrêter la journée.
    const avertissements = configWarnings(
      config({
        totalCapital: '10000',
        aiAllocationPct: 100,
        maxTradeAmount: '5000',
        maxTradePct: 100,
        maxDailyLossPct: 1,
      }),
    );
    expect(avertissements).toContain('daily-below-trade');
  });
});

describe('repli depuis le sommet', () => {
  it('chiffre le repli en pourcentage', () => {
    expect(drawdownPct(d(8500), d(10000))).toBeCloseTo(15, 6);
  });

  it('rend zéro sur un nouveau sommet, jamais un négatif', () => {
    expect(drawdownPct(d(11000), d(10000))).toBe(0);
  });

  it('rend null plutôt qu’un infini sur un sommet nul', () => {
    expect(drawdownPct(d(0), d(0))).toBeNull();
  });
});
