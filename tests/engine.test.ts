import { describe, expect, it } from 'vitest';

import { Engine } from '@/engine/Engine';
import { Ledger } from '@/engine/Ledger';
import { StandardRisk } from '@/engine/modules/StandardRisk';
import { d } from '@/lib/decimal';
import { DEFAULT_CONFIG } from '@/lib/portfolioMath';
import type { RiskContext, TargetPosition } from '@/engine/interfaces';
import type { Fill } from '@/types/trading';

import { serieSynthetique } from './helpers/series';

const TF = '1h';
const H = 3_600;

function moteur(bars = serieSynthetique(400), patch = {}): Engine {
  return new Engine({
    symbol: 'TEST',
    timeframe: TF,
    bars,
    config: { ...DEFAULT_CONFIG, maxTradesPerHour: 240, ...patch },
  });
}

describe('livrable de la phase : un croisement d’EMA produit des trades', () => {
  it('déroule la série et génère des trades simulés', () => {
    const resultat = moteur().run();
    expect(resultat.barsProcessed).toBe(400);
    expect(resultat.signals).toBeGreaterThan(0);
    expect(resultat.trades.length).toBeGreaterThan(0);
  });

  it('chaque trade porte un P&L net de frais', () => {
    // Un P&L brut ne dit pas si le trade valait la peine d'être pris.
    for (const trade of moteur().run().trades) {
      expect(trade.fees.estZero()).toBe(false);
      const brut =
        trade.side === 'buy'
          ? trade.exitPrice.moins(trade.entryPrice).fois(trade.quantity)
          : trade.entryPrice.moins(trade.exitPrice).fois(trade.quantity);
      expect(trade.pnl.versTexte(8)).toBe(brut.moins(trade.fees).versTexte(8));
    }
  });

  it('aucun signal n’est émis sans son explication', () => {
    // L'interface a l'interdiction d'afficher un signal sans sa raison : la
    // faire manquer ici la rendrait impossible à afficher plus tard.
    const m = moteur();
    let vus = 0;
    m.bus.on('signal', (signal) => {
      expect(signal.reason.length).toBeGreaterThan(0);
      expect(Object.keys(signal.features).length).toBeGreaterThan(0);
      vus += 1;
    });
    m.run();
    expect(vus).toBeGreaterThan(0);
  });

  it('ne parle pas avant la fin de l’échauffement', () => {
    // Un indicateur non établi rend une valeur qui ne veut rien dire ; croiser
    // deux valeurs pareilles fabrique des signaux qui n'existent pas.
    const bars = serieSynthetique(400);
    const m = moteur(bars);
    let premier = Number.POSITIVE_INFINITY;
    m.bus.on('signal', (signal) => {
      premier = Math.min(premier, signal.timestamp);
    });
    m.run();
    expect(premier).toBeGreaterThanOrEqual((bars[26]?.time ?? 0) + H);
  });

  it('rejoue à l’identique après reset', () => {
    // Sans cela, comparer deux réglages sur la même série ne voudrait rien dire.
    const bars = serieSynthetique(300, 11);
    const m = moteur(bars);
    const premier = m.run().trades.map((t) => t.pnl.versTexte(8));
    m.reset();
    expect(m.run().trades.map((t) => t.pnl.versTexte(8))).toEqual(premier);
  });

  it('l’arrêt d’urgence coupe toute nouvelle prise de position', () => {
    const bars = serieSynthetique(400);
    const m = moteur(bars);
    let ordres = 0;
    m.bus.on('order', () => {
      ordres += 1;
      if (ordres === 2) m.halt('test');
    });
    m.run();
    expect(ordres).toBe(2);
  });
});

describe('livre de comptes', () => {
  const fill = (patch: Partial<Fill> = {}): Fill => ({
    orderId: 'o1',
    symbol: 'TEST',
    side: 'buy',
    quantity: d(2),
    price: d(100),
    fee: d(1),
    slippage: d(0),
    filledAt: H,
    ...patch,
  });

  it('sort le notionnel et les frais du solde à l’ouverture', () => {
    const livre = new Ledger(d(10_000));
    livre.applyFill(fill());
    expect(livre.cash.versTexte(2)).toBe('9799.00'); // 10 000 − 200 − 1
    expect(livre.positions()).toHaveLength(1);
  });

  it('rend le notionnel et le résultat à la fermeture', () => {
    const livre = new Ledger(d(10_000));
    livre.applyFill(fill());
    const trade = livre.applyFill(fill({ side: 'sell', price: d(110), fee: d(1) }));
    // Brut = (110 − 100) × 2 = 20 ; frais = 1 + 1 = 2 ; net = 18.
    expect(trade?.pnl.versTexte(2)).toBe('18.00');
    expect(livre.cash.versTexte(2)).toBe('10018.00');
    expect(livre.positions()).toHaveLength(0);
  });

  it('compte les frais d’entrée ET de sortie dans le trade', () => {
    const livre = new Ledger(d(10_000));
    livre.applyFill(fill({ fee: d(3) }));
    const trade = livre.applyFill(fill({ side: 'sell', price: d(100), fee: d(4) }));
    expect(trade?.fees.versTexte(2)).toBe('7.00');
    // Un aller-retour à prix constant est perdant. C'est le point.
    expect(trade?.pnl.versTexte(2)).toBe('-7.00');
  });

  it('gagne quand un short baisse', () => {
    const livre = new Ledger(d(10_000));
    livre.applyFill(fill({ side: 'sell' }));
    const trade = livre.applyFill(fill({ side: 'buy', price: d(90), fee: d(1) }));
    expect(trade?.pnl.versTexte(2)).toBe('18.00'); // (100 − 90) × 2 − 2
  });

  it('retient le stop quand stop et objectif tombent dans la même bougie', () => {
    // Rien dans une bougie ne dit lequel a été touché en premier. Choisir
    // l'objectif serait choisir l'hypothèse qui flatte, et répétée sur des
    // milliers de bougies elle fabrique une performance qui n'existe pas.
    const livre = new Ledger(d(10_000));
    livre.applyFill(fill(), { stopLoss: d(95), takeProfit: d(105) });
    const touches = livre.checkBarriers('TEST', {
      time: 2 * H,
      open: 100,
      high: 106,
      low: 94,
      close: 100,
      volume: 1,
    });
    expect(touches).toHaveLength(1);
    expect(touches[0]?.reason).toBe('stop');
  });

  it('l’équité suit le latent sans que le solde bouge', () => {
    // Compter un gain non encaissé comme de l'argent disponible permettrait de
    // le dépenser deux fois.
    const livre = new Ledger(d(10_000));
    livre.applyFill(fill());
    const solde = livre.cash.versTexte(2);
    const equite = livre.equity(new Map([['TEST', d(120)]]));
    expect(equite.versTexte(2)).toBe('10039.00'); // 9 799 + 200 + 40
    expect(livre.cash.versTexte(2)).toBe(solde);
  });
});

describe('contrôles de risque', () => {
  const cible = (notional: number, quantity: number): TargetPosition => ({
    symbol: 'TEST',
    side: 'buy',
    quantity: d(quantity),
    lotStep: d('0.00001'),
    notional: d(notional),
    reason: 'test',
    signal: {
      symbol: 'TEST',
      direction: 'long',
      confidence: 1,
      timestamp: 0,
      reason: 'test',
      features: {},
    },
  });

  const contexte = (patch: Partial<RiskContext> = {}): RiskContext => ({
    now: 1_000_000,
    config: DEFAULT_CONFIG,
    aiCapital: d(10_000),
    cash: d(10_000),
    equity: d(10_000),
    peakEquity: d(10_000),
    price: d(100),
    positions: [],
    dailyLoss: d(0),
    recentOrderTimes: [],
    ...patch,
  });

  it('approuve une intention dans les clous', () => {
    expect(new StandardRisk().vet(cible(150, 1.5), contexte()).kind).toBe('approve');
  });

  it('réduit au lieu de refuser quand seul le plafond par trade est dépassé', () => {
    // Une position plus petite reste une position valable.
    const verdict = new StandardRisk().vet(cible(5_000, 50), contexte());
    expect(verdict.kind).toBe('reduce');
    if (verdict.kind !== 'reduce') return;
    // Plafond = min(10 000 × 2 %, 1 000) = 200.
    expect(verdict.target.notional.plusGrandQue(d(200))).toBe(false);
    expect(verdict.target.quantity.estZero()).toBe(false);
  });

  it('refuse au-delà du repli maximal, sans chercher à réduire', () => {
    // Un compte en repli maximal ne doit pas recevoir « taille réduite », il
    // doit recevoir « on arrête ».
    const verdict = new StandardRisk().vet(
      cible(100, 1),
      contexte({ equity: d(8_000), peakEquity: d(10_000) }), // repli 2 000 > 1 500
    );
    expect(verdict.kind).toBe('reject');
  });

  it('refuse au-delà de la perte du jour', () => {
    const verdict = new StandardRisk().vet(
      cible(100, 1),
      contexte({ dailyLoss: d(400) }), // limite = 10 000 × 3 % = 300
    );
    expect(verdict.kind).toBe('reject');
  });

  it('refuse au-delà du nombre de positions ouvertes', () => {
    const positions = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      symbol: `S${i}`,
      side: 'buy' as const,
      quantity: d(1),
      entryPrice: d(10),
      openedAt: 0,
      feesPaid: d(0),
    }));
    expect(new StandardRisk().vet(cible(100, 1), contexte({ positions })).kind).toBe('reject');
  });

  it('refuse au-delà de la cadence horaire', () => {
    // Une stratégie qui oscille peut brûler l'enveloppe en frais sans jamais
    // perdre sur le prix.
    const recentOrderTimes = Array.from({ length: 6 }, (_, i) => 1_000_000 - i * 60);
    expect(new StandardRisk().vet(cible(100, 1), contexte({ recentOrderTimes })).kind).toBe(
      'reject',
    );
  });

  it('ignore les ordres sortis de la fenêtre d’une heure', () => {
    const recentOrderTimes = Array.from({ length: 6 }, (_, i) => 1_000_000 - 7_200 - i * 60);
    expect(new StandardRisk().vet(cible(100, 1), contexte({ recentOrderTimes })).kind).toBe(
      'approve',
    );
  });

  it('refuse quand l’enveloppe est déjà entièrement engagée', () => {
    // Cinq positions au plafond individuel pourraient sinon engager cinq fois
    // l'enveloppe confiée.
    const positions = [
      {
        id: 'p1',
        symbol: 'TEST',
        side: 'buy' as const,
        quantity: d(100),
        entryPrice: d(100),
        openedAt: 0,
        feesPaid: d(0),
      },
    ];
    expect(new StandardRisk().vet(cible(100, 1), contexte({ positions })).kind).toBe('reject');
  });

  it('porte un motif lisible sur chaque refus', () => {
    // « Ordre refusé » sans explication conduit à désactiver le contrôle qui
    // protégeait.
    const verdict = new StandardRisk().vet(cible(100, 1), contexte({ dailyLoss: d(400) }));
    if (verdict.kind !== 'reject') throw new Error('attendu : refus');
    expect(verdict.reason.length).toBeGreaterThan(10);
  });
});
