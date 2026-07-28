import { describe, expect, it } from 'vitest';

import { ATR, EMA, RSI, SMA } from '@/engine/indicators';
import type { Bar } from '@/types/market';

/**
 * Un indicateur faux ne plante pas : il produit des chiffres crédibles et
 * déplace tous les signaux de quelques bougies. C'est le genre de faute qui
 * survit des mois si personne ne compare à un calcul fait à la main.
 */

const b = (close: number, high = close, low = close): Bar => ({
  time: 0,
  open: close,
  high,
  low,
  close,
  volume: 1,
});

describe('SMA', () => {
  it('n’est établie qu’une fois la fenêtre pleine', () => {
    const sma = new SMA(3);
    sma.update(b(1));
    sma.update(b(2));
    expect(sma.ready).toBe(false);
    sma.update(b(3));
    expect(sma.ready).toBe(true);
    expect(sma.value).toBe(2);
  });

  it('fait glisser la fenêtre', () => {
    const sma = new SMA(3);
    [1, 2, 3, 4, 5].forEach((prix) => sma.update(b(prix)));
    expect(sma.value).toBe(4);
  });
});

describe('EMA', () => {
  it('s’amorce sur une SMA, pas sur le premier prix', () => {
    // Partir d'un seul point donne à cette bougie un poids qui met des
    // dizaines de périodes à s'estomper et décale tous les croisements.
    const ema = new EMA(3);
    [10, 20, 30].forEach((prix) => ema.update(b(prix)));
    expect(ema.ready).toBe(true);
    expect(ema.value).toBe(20);
  });

  it('n’est pas établie avant sa période', () => {
    const ema = new EMA(5);
    [1, 2, 3, 4].forEach((prix) => ema.update(b(prix)));
    expect(ema.ready).toBe(false);
  });

  it('applique le bon coefficient après amorçage', () => {
    const ema = new EMA(3); // k = 2/4 = 0,5
    [10, 20, 30].forEach((prix) => ema.update(b(prix)));
    expect(ema.update(b(40))).toBeCloseTo(30, 10); // 40×0,5 + 20×0,5
    expect(ema.update(b(50))).toBeCloseTo(40, 10);
  });

  it('refuse une période rapide plus longue que la lente à la construction', () => {
    expect(() => new EMA(0)).toThrow();
  });

  it('repart de zéro après reset', () => {
    const ema = new EMA(3);
    [10, 20, 30].forEach((prix) => ema.update(b(prix)));
    ema.reset();
    expect(ema.ready).toBe(false);
  });
});

describe('ATR', () => {
  it('inclut l’écart avec la clôture précédente', () => {
    // Sans le « vrai » range, un marché qui ouvre en trou paraîtrait calme
    // alors qu'il vient de sauter.
    const atr = new ATR(2);
    atr.update(b(100, 101, 99)); // TR = 2
    // Bougie qui saute : haut 120, bas 118, clôture précédente 100 → TR = 20.
    atr.update(b(119, 120, 118));
    expect(atr.ready).toBe(true);
    expect(atr.value).toBeCloseTo(11, 10); // (2 + 20) / 2
  });

  it('n’est pas établi avant sa période', () => {
    const atr = new ATR(3);
    atr.update(b(100, 101, 99));
    expect(atr.ready).toBe(false);
  });
});

describe('RSI', () => {
  it('vaut 100 sur une hausse ininterrompue', () => {
    const rsi = new RSI(5);
    for (let i = 1; i <= 10; i += 1) rsi.update(b(100 + i));
    expect(rsi.ready).toBe(true);
    expect(rsi.value).toBeCloseTo(100, 6);
  });

  it('vaut 0 sur une baisse ininterrompue', () => {
    const rsi = new RSI(5);
    for (let i = 1; i <= 10; i += 1) rsi.update(b(100 - i));
    expect(rsi.value).toBeCloseTo(0, 6);
  });

  it('vaut 50 à l’amorçage quand hausses et baisses s’équilibrent', () => {
    // À l'amorçage, les moyennes sont de simples moyennes : quatre variations
    // alternées donnent exactement 50.
    const rsi = new RSI(4);
    [100, 101, 100, 101, 100].forEach((prix) => rsi.update(b(prix)));
    expect(rsi.ready).toBe(true);
    expect(rsi.value).toBeCloseTo(50, 10);
  });

  it('penche du côté de la dernière variation, comme le veut Wilder', () => {
    // Après amorçage, le lissage de Wilder donne plus de poids à la variation
    // récente : sur une série alternée le RSI oscille autour de 50 sans y
    // rester. Attendre 50 exactement reviendrait à attendre une moyenne
    // simple, et masquerait une erreur de lissage.
    const prix = [100, 101, 100, 101, 100, 101, 100, 101];
    const apresHausse = new RSI(4);
    prix.forEach((valeur) => apresHausse.update(b(valeur)));
    expect(apresHausse.value).toBeGreaterThan(50);

    const apresBaisse = new RSI(4);
    [...prix, 100].forEach((valeur) => apresBaisse.update(b(valeur)));
    expect(apresBaisse.value).toBeLessThan(50);
  });

  it('n’est pas établi avant sa période', () => {
    const rsi = new RSI(14);
    [1, 2, 3].forEach((prix) => rsi.update(b(prix)));
    expect(rsi.ready).toBe(false);
  });
});
