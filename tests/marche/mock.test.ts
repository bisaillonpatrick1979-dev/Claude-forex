import { describe, expect, it } from 'vitest';

import { genererSerie } from '@/lib/marche/fournisseurs/mock';
import { dureeSecondes } from '@/lib/marche/intervalles';
import type { DemandeChandeliers } from '@/lib/marche/types';

const DEMANDE: DemandeChandeliers = {
  symbole: 'EURUSD',
  classeActif: 'FOREX',
  intervalle: 'M5',
  limite: 50,
};

const INSTANT = 1_785_000_000; // instant fixe, pour que les tests soient stables

describe('adaptateur mock', () => {
  it('produit exactement le nombre de bougies demandé', () => {
    expect(genererSerie(DEMANDE, INSTANT)).toHaveLength(50);
  });

  it('rend une série strictement chronologique et régulièrement espacée', () => {
    const serie = genererSerie(DEMANDE, INSTANT);
    const pas = dureeSecondes('M5');
    for (let i = 1; i < serie.length; i += 1) {
      expect(serie[i]!.horodatage - serie[i - 1]!.horodatage).toBe(pas);
    }
  });

  it('respecte l’invariant OHLC : bas ≤ min(o,c) et haut ≥ max(o,c)', () => {
    for (const bougie of genererSerie(DEMANDE, INSTANT)) {
      expect(bougie.bas).toBeLessThanOrEqual(Math.min(bougie.ouverture, bougie.cloture));
      expect(bougie.haut).toBeGreaterThanOrEqual(Math.max(bougie.ouverture, bougie.cloture));
    }
  });

  /**
   * Le point le plus important : le cache et le backtest ne valent rien si la
   * même bougie change de valeur selon la fenêtre demandée.
   */
  it('donne la même bougie quelle que soit la fenêtre demandée', () => {
    const courte = genererSerie({ ...DEMANDE, limite: 10 }, INSTANT);
    const longue = genererSerie({ ...DEMANDE, limite: 200 }, INSTANT);

    for (const bougie of courte) {
      const correspondante = longue.find((autre) => autre.horodatage === bougie.horodatage);
      expect(correspondante).toEqual(bougie);
    }
  });

  it('donne la même bougie à deux appels séparés dans le temps', () => {
    const premier = genererSerie(DEMANDE, INSTANT);
    const second = genererSerie(DEMANDE, INSTANT + 4 * 60); // même bougie en cours
    const commun = premier.filter((bougie) =>
      second.some((autre) => autre.horodatage === bougie.horodatage),
    );

    expect(commun.length).toBeGreaterThan(0);
    for (const bougie of commun) {
      expect(second.find((autre) => autre.horodatage === bougie.horodatage)).toEqual(bougie);
    }
  });

  it('sépare les symboles : deux instruments n’ont pas la même série', () => {
    const euro = genererSerie(DEMANDE, INSTANT);
    const nasdaq = genererSerie({ ...DEMANDE, symbole: 'NAS100', classeActif: 'INDICE' }, INSTANT);
    expect(euro[0]!.cloture).not.toBe(nasdaq[0]!.cloture);
  });

  it('reste dans un ordre de grandeur crédible pour le symbole', () => {
    for (const bougie of genererSerie(DEMANDE, INSTANT)) {
      expect(bougie.cloture).toBeGreaterThan(0.9);
      expect(bougie.cloture).toBeLessThan(1.3);
    }
  });
});
