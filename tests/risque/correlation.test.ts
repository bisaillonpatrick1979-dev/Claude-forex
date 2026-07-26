import { describe, expect, it } from 'vitest';

import { compterCorrelees, correlationEstimee, type ExpositionPosition } from '@/lib/risque/correlation';

function fx(instrument: string, base: string, cotation: string, sens: 'ACHAT' | 'VENTE'): ExpositionPosition {
  return { instrument, classeActif: 'FOREX', deviseBase: base, deviseCotation: cotation, sens };
}

/**
 * L'estimation par exposition aux devises doit reproduire les intuitions de
 * base du Forex, sinon le plafond de positions corrélées ne protège de rien :
 * on se retrouverait avec cinq fois le même pari sous cinq noms différents.
 */
describe('corrélation par exposition aux devises', () => {
  const eurusdLong = fx('EURUSD', 'EUR', 'USD', 'ACHAT');

  it('donne 1 pour le même instrument dans le même sens', () => {
    expect(correlationEstimee(eurusdLong, fx('EURUSD', 'EUR', 'USD', 'ACHAT'))).toBe(1);
  });

  it('donne −1 pour le même instrument en sens inverse', () => {
    expect(correlationEstimee(eurusdLong, fx('EURUSD', 'EUR', 'USD', 'VENTE'))).toBe(-1);
  });

  it('voit EUR/USD et GBP/USD longs comme corrélés positivement', () => {
    const correlation = correlationEstimee(eurusdLong, fx('GBPUSD', 'GBP', 'USD', 'ACHAT'));
    expect(correlation).toBeGreaterThan(0.4);
    expect(correlation).toBeLessThan(1);
  });

  it('voit EUR/USD long et USD/CHF long comme corrélés négativement', () => {
    expect(correlationEstimee(eurusdLong, fx('USDCHF', 'USD', 'CHF', 'ACHAT'))).toBeLessThan(0);
  });

  it('voit EUR/USD long et USD/JPY short comme corrélés positivement', () => {
    // Les deux reviennent à vendre du dollar.
    expect(correlationEstimee(eurusdLong, fx('USDJPY', 'USD', 'JPY', 'VENTE'))).toBeGreaterThan(0);
  });

  it('ne voit aucune corrélation entre paires sans devise commune', () => {
    expect(correlationEstimee(fx('EURGBP', 'EUR', 'GBP', 'ACHAT'), fx('AUDJPY', 'AUD', 'JPY', 'ACHAT'))).toBe(0);
  });
});

describe('corrélation par classe d’actifs', () => {
  const nasdaq: ExpositionPosition = {
    instrument: 'NAS100',
    classeActif: 'INDICE',
    deviseBase: null,
    deviseCotation: 'USD',
    sens: 'ACHAT',
  };
  const sp500: ExpositionPosition = { ...nasdaq, instrument: 'SPX500' };

  it('traite deux indices dans le même sens comme fortement corrélés', () => {
    expect(correlationEstimee(nasdaq, sp500)).toBeGreaterThanOrEqual(0.7);
  });

  it('inverse le signe quand les sens s’opposent', () => {
    expect(correlationEstimee(nasdaq, { ...sp500, sens: 'VENTE' })).toBeLessThan(0);
  });

  it('ne relie pas des classes différentes', () => {
    expect(correlationEstimee(nasdaq, fx('EURUSD', 'EUR', 'USD', 'ACHAT'))).toBe(0);
  });
});

describe('comptage des positions corrélées', () => {
  it('ne compte que celles au-dessus du seuil', () => {
    const proposee = fx('EURUSD', 'EUR', 'USD', 'ACHAT');
    const ouvertes = [
      fx('EURUSD', 'EUR', 'USD', 'ACHAT'), // 1
      fx('GBPUSD', 'GBP', 'USD', 'ACHAT'), // 0,5
      fx('USDCHF', 'USD', 'CHF', 'ACHAT'), // négatif
    ];

    expect(compterCorrelees(proposee, ouvertes, 0.7)).toBe(1);
    expect(compterCorrelees(proposee, ouvertes, 0.4)).toBe(2);
  });
});
