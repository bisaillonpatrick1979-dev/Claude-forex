import { describe, expect, it } from 'vitest';

import {
  atr,
  derniereValeur,
  macd,
  moyenneMobileExponentielle,
  moyenneMobileSimple,
  rsi,
} from '@/lib/marche/indicateurs';
import type { Chandelier } from '@/lib/marche/types';

/**
 * Ces indicateurs alimentent à la fois le graphique et le snapshot passé à
 * l'analyste technique. Une erreur ici produirait un agent qui raisonne sur
 * des chiffres faux tout en citant « des valeurs du snapshot » — exactement ce
 * que l'ancrage des données est censé empêcher.
 */

const SUITE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('règle commune : longueur préservée, null avant amorçage', () => {
  it('rend une série de même longueur que l’entrée', () => {
    expect(moyenneMobileSimple(SUITE, 3)).toHaveLength(SUITE.length);
    expect(moyenneMobileExponentielle(SUITE, 3)).toHaveLength(SUITE.length);
    expect(rsi(SUITE, 5)).toHaveLength(SUITE.length);
  });

  it('laisse null — et jamais zéro — avant d’avoir assez de données', () => {
    const sma = moyenneMobileSimple(SUITE, 3);
    expect(sma[0]).toBeNull();
    expect(sma[1]).toBeNull();
    expect(sma[2]).not.toBeNull();
  });

  it('rend une série entièrement nulle si l’entrée est trop courte', () => {
    expect(moyenneMobileSimple([1, 2], 5).every((valeur) => valeur === null)).toBe(true);
    expect(rsi([1, 2, 3], 14).every((valeur) => valeur === null)).toBe(true);
  });
});

describe('moyennes mobiles', () => {
  it('calcule la moyenne simple exactement', () => {
    const sma = moyenneMobileSimple(SUITE, 3);
    expect(sma[2]).toBeCloseTo(2, 10); // (1+2+3)/3
    expect(sma[9]).toBeCloseTo(9, 10); // (8+9+10)/3
  });

  it('amorce l’EMA sur une moyenne simple, comme les plateformes de trading', () => {
    const ema = moyenneMobileExponentielle(SUITE, 3);
    expect(ema[2]).toBeCloseTo(2, 10); // amorçage = SMA(1,2,3)
    // facteur = 2/(3+1) = 0,5 → (4 - 2) * 0,5 + 2 = 3
    expect(ema[3]).toBeCloseTo(3, 10);
  });

  it('suit une série constante sans dériver', () => {
    const constante = new Array(30).fill(42) as number[];
    expect(derniereValeur(moyenneMobileSimple(constante, 10))).toBeCloseTo(42, 10);
    expect(derniereValeur(moyenneMobileExponentielle(constante, 10))).toBeCloseTo(42, 10);
  });
});

describe('RSI', () => {
  it('vaut 100 sur une hausse ininterrompue', () => {
    const hausse = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(derniereValeur(rsi(hausse, 14))).toBeCloseTo(100, 6);
  });

  it('vaut 0 sur une baisse ininterrompue', () => {
    const baisse = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(derniereValeur(rsi(baisse, 14))).toBeCloseTo(0, 6);
  });

  /** Une division par zéro donnerait NaN, qui se propagerait sans rien casser
   *  visiblement — le pire des cas. */
  it('ne produit jamais NaN, même sans variation', () => {
    const plat = new Array(40).fill(50) as number[];
    const valeurs = rsi(plat, 14).filter((valeur): valeur is number => valeur !== null);
    expect(valeurs.length).toBeGreaterThan(0);
    expect(valeurs.every(Number.isFinite)).toBe(true);
  });

  it('reste borné entre 0 et 100', () => {
    const bruite = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 3) * 10 + i * 0.1);
    for (const valeur of rsi(bruite, 14)) {
      if (valeur === null) continue;
      expect(valeur).toBeGreaterThanOrEqual(0);
      expect(valeur).toBeLessThanOrEqual(100);
    }
  });
});

describe('MACD', () => {
  it('rend trois séries de la longueur de l’entrée', () => {
    const valeurs = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5);
    const resultat = macd(valeurs);
    expect(resultat.macd).toHaveLength(80);
    expect(resultat.signal).toHaveLength(80);
    expect(resultat.histogramme).toHaveLength(80);
  });

  it('vérifie l’identité histogramme = macd − signal', () => {
    const valeurs = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5);
    const { macd: ligne, signal, histogramme } = macd(valeurs);

    for (let i = 0; i < valeurs.length; i += 1) {
      const l = ligne[i];
      const s = signal[i];
      const h = histogramme[i];
      if (l === null || s === null || l === undefined || s === undefined) {
        expect(h).toBeNull();
      } else {
        expect(h).toBeCloseTo(l - s, 10);
      }
    }
  });

  it('tend vers zéro sur une série constante', () => {
    const constante = new Array(80).fill(10) as number[];
    expect(derniereValeur(macd(constante).macd)).toBeCloseTo(0, 10);
  });
});

describe('ATR', () => {
  function bougies(valeurs: readonly { h: number; b: number; c: number }[]): Chandelier[] {
    return valeurs.map((valeur, i) => ({
      horodatage: 1_785_000_000 + i * 300,
      ouverture: valeur.c,
      haut: valeur.h,
      bas: valeur.b,
      cloture: valeur.c,
      volume: null,
    }));
  }

  it('vaut l’amplitude constante quand chaque bougie a le même range', () => {
    const serie = bougies(Array.from({ length: 40 }, () => ({ h: 102, b: 100, c: 101 })));
    expect(derniereValeur(atr(serie, 14))).toBeCloseTo(2, 6);
  });

  /** Le vrai range prend en compte l'écart avec la clôture précédente : un gap
   *  d'ouverture doit gonfler l'ATR, sinon la taille de position sera calculée
   *  sur une volatilité sous-estimée. */
  it('prend en compte les gaps entre bougies', () => {
    const sansGap = bougies(Array.from({ length: 40 }, () => ({ h: 102, b: 100, c: 101 })));
    const avecGap = bougies(
      Array.from({ length: 40 }, (_, i) =>
        i === 30 ? { h: 122, b: 120, c: 121 } : { h: 102, b: 100, c: 101 },
      ),
    );
    expect(derniereValeur(atr(avecGap, 14))!).toBeGreaterThan(derniereValeur(atr(sansGap, 14))!);
  });

  it('reste nul tant qu’il n’y a pas assez de bougies', () => {
    const serie = bougies(Array.from({ length: 10 }, () => ({ h: 102, b: 100, c: 101 })));
    expect(atr(serie, 14).every((valeur) => valeur === null)).toBe(true);
  });
});
