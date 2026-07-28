import { describe, expect, it } from 'vitest';

import {
  etatSeances,
  libelleSeance,
  prochainChangementSeance,
  seanceDe,
} from '@/lib/marche/seances-mondiales';

/**
 * Les séances se déduisent de l'horodatage, jamais d'une colonne : un trade
 * de l'an dernier doit se rattacher à sa séance aussi sûrement qu'un trade de
 * l'instant. Ces tests fixent les frontières, y compris celles qui franchissent
 * minuit — c'est là que ce genre de calcul se trompe.
 */

/** Un mercredi, pour rester loin des bornes du week-end. */
function mercrediA(heureUtc: number, minutes = 0): number {
  return Math.floor(Date.UTC(2026, 6, 22, heureUtc, minutes, 0) / 1000);
}

describe('etatSeances', () => {
  // 7 h UTC est le seul créneau où Tokyo est seule : Sydney a fermé à 6 h,
  // Londres n'ouvre qu'à 8 h.
  it('désigne Tokyo seule entre la fermeture de Sydney et l’ouverture de Londres', () => {
    const etat = etatSeances(mercrediA(7));
    expect(etat.ouvertes).toEqual(['TOKYO']);
    expect(etat.dominante).toBe('TOKYO');
    expect(etat.chevauchement).toBeNull();
  });

  it('nomme Sydney × Tokyo la nuit, quand les deux se chevauchent', () => {
    const etat = etatSeances(mercrediA(3));
    expect(etat.dominante).toBe('TOKYO');
    expect(etat.chevauchement).toBe('Sydney × Tokyo');
  });

  it('désigne Londres et nomme le chevauchement Tokyo × Londres', () => {
    const etat = etatSeances(mercrediA(8, 30));
    expect(etat.ouvertes).toContain('TOKYO');
    expect(etat.ouvertes).toContain('LONDRES');
    // Londres prime : c'est la séance qu'un trader nommerait.
    expect(etat.dominante).toBe('LONDRES');
    expect(etat.chevauchement).toBe('Tokyo × Londres');
  });

  it('nomme le chevauchement Londres × New York, le plus liquide de la journée', () => {
    const etat = etatSeances(mercrediA(14));
    expect(etat.dominante).toBe('LONDRES');
    expect(etat.chevauchement).toBe('Londres × New York');
  });

  it('désigne New York seule après la fermeture de Londres', () => {
    const etat = etatSeances(mercrediA(18));
    expect(etat.ouvertes).toEqual(['NEW_YORK']);
    expect(etat.dominante).toBe('NEW_YORK');
    expect(etat.chevauchement).toBeNull();
  });

  it('gère Sydney, qui franchit minuit', () => {
    expect(etatSeances(mercrediA(22)).ouvertes).toContain('SYDNEY');
    expect(etatSeances(mercrediA(2)).ouvertes).toContain('SYDNEY');
    expect(etatSeances(mercrediA(12)).ouvertes).not.toContain('SYDNEY');
  });

  it('ne rattache aucune séance au week-end plutôt que d’en inventer une', () => {
    const samedi = Math.floor(Date.UTC(2026, 6, 25, 12, 0, 0) / 1000);
    const etat = etatSeances(samedi);

    expect(etat.weekEnd).toBe(true);
    expect(etat.ouvertes).toEqual([]);
    expect(etat.dominante).toBeNull();
    expect(seanceDe(samedi)).toBeNull();
  });
});

describe('prochainChangementSeance', () => {
  it('trouve la fermeture de Tokyo à 9 h UTC', () => {
    const depart = mercrediA(8, 30);
    const changement = prochainChangementSeance(depart);

    expect(changement).not.toBeNull();
    expect(new Date(changement! * 1000).getUTCHours()).toBe(9);
    expect(new Date(changement! * 1000).getUTCMinutes()).toBe(0);
  });

  it('trouve l’ouverture de New York à 13 h UTC', () => {
    const changement = prochainChangementSeance(mercrediA(11));
    expect(new Date(changement! * 1000).getUTCHours()).toBe(13);
  });

  it('rend toujours un instant strictement postérieur', () => {
    for (const heure of [0, 5, 9, 13, 17, 21, 23]) {
      const depart = mercrediA(heure);
      const changement = prochainChangementSeance(depart);
      expect(changement).not.toBeNull();
      expect(changement!).toBeGreaterThan(depart);
    }
  });
});

describe('libelleSeance', () => {
  it('nomme le chevauchement quand il y en a un', () => {
    expect(libelleSeance(mercrediA(14))).toBe('Londres × New York');
  });

  it('nomme la séance seule sinon', () => {
    expect(libelleSeance(mercrediA(18))).toBe('New York');
  });

  it('dit « hors marché » le week-end au lieu de laisser un vide', () => {
    expect(libelleSeance(Math.floor(Date.UTC(2026, 6, 25, 12) / 1000))).toBe('Hors marché');
  });
});
