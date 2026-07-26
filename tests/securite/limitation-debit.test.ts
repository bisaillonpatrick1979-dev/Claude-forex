import { beforeEach, describe, expect, it } from 'vitest';

import { limiterDebit, reinitialiserLimitation } from '@/lib/securite/limitation-debit';

describe('limitation de débit', () => {
  beforeEach(() => {
    reinitialiserLimitation();
  });

  it('laisse passer jusqu’au plafond puis refuse', () => {
    const debut = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(limiterDebit('cle', 5, 60_000, debut).autorise).toBe(true);
    }
    expect(limiterDebit('cle', 5, 60_000, debut).autorise).toBe(false);
  });

  it('régénère progressivement plutôt qu’en une seule bascule de fenêtre', () => {
    const debut = 1_000_000;
    for (let i = 0; i < 5; i += 1) limiterDebit('cle', 5, 60_000, debut);

    // Un cinquième de la fenêtre écoulé : un jeton doit être revenu.
    expect(limiterDebit('cle', 5, 60_000, debut + 12_000).autorise).toBe(true);
    expect(limiterDebit('cle', 5, 60_000, debut + 12_000).autorise).toBe(false);
  });

  it('isole les compteurs par clé', () => {
    const debut = 1_000_000;
    for (let i = 0; i < 5; i += 1) limiterDebit('profil-a', 5, 60_000, debut);

    expect(limiterDebit('profil-a', 5, 60_000, debut).autorise).toBe(false);
    expect(limiterDebit('profil-b', 5, 60_000, debut).autorise).toBe(true);
  });

  it('indique dans combien de temps réessayer', () => {
    const debut = 1_000_000;
    for (let i = 0; i < 5; i += 1) limiterDebit('cle', 5, 60_000, debut);

    const refus = limiterDebit('cle', 5, 60_000, debut);
    expect(refus.reessayerDansMs).toBeGreaterThan(0);
    expect(refus.reessayerDansMs).toBeLessThanOrEqual(60_000);
  });
});
