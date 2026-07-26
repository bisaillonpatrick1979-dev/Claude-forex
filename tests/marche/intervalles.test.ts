import { describe, expect, it } from 'vitest';

import { bougieFermee, debutBougie, dureeSecondes, ttlSecondes } from '@/lib/marche/intervalles';

describe('alignement des bougies', () => {
  it('aligne sur le début de la période', () => {
    // 2026-07-24 13:37:42 UTC
    const instant = Date.UTC(2026, 6, 24, 13, 37, 42) / 1000;
    expect(debutBougie(instant, 'M5')).toBe(Date.UTC(2026, 6, 24, 13, 35, 0) / 1000);
    expect(debutBougie(instant, 'H1')).toBe(Date.UTC(2026, 6, 24, 13, 0, 0) / 1000);
    expect(debutBougie(instant, 'D1')).toBe(Date.UTC(2026, 6, 24, 0, 0, 0) / 1000);
  });

  /**
   * Le 1er janvier 1970 était un jeudi : diviser brutalement par 604800 place
   * le début de semaine un jeudi. Ce test verrouille la correction.
   */
  it('aligne les semaines sur le lundi, pas sur le jeudi', () => {
    const vendredi = Date.UTC(2026, 6, 24, 12, 0, 0) / 1000;
    const debut = debutBougie(vendredi, 'W1');
    expect(new Date(debut * 1000).getUTCDay()).toBe(1);
    expect(debut).toBe(Date.UTC(2026, 6, 20, 0, 0, 0) / 1000);
  });

  it('déclare une bougie fermée seulement après sa durée complète', () => {
    const ouverture = Date.UTC(2026, 6, 24, 13, 35, 0) / 1000;
    expect(bougieFermee(ouverture, 'M5', ouverture + 299)).toBe(false);
    expect(bougieFermee(ouverture, 'M5', ouverture + 300)).toBe(true);
  });

  it('donne des TTL croissants avec l’intervalle', () => {
    expect(ttlSecondes('M1')).toBeLessThan(ttlSecondes('H1'));
    expect(ttlSecondes('H1')).toBeLessThan(ttlSecondes('D1'));
    expect(dureeSecondes('H4')).toBe(4 * dureeSecondes('H1'));
  });
});
