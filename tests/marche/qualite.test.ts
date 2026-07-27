import { describe, expect, it } from 'vitest';

import { dureeSecondes } from '@/lib/marche/intervalles';
import { resumerQualite, verifierSerie, type CodeAnomalie } from '@/lib/marche/qualite';
import type { Chandelier } from '@/lib/marche/types';

/**
 * Le contrôle qualité n'a de valeur que s'il distingue les vrais défauts des
 * absences normales. Un rapport qui signale chaque week-end comme un trou est
 * un rapport que personne ne lit — et une série corrompue passe alors sans être
 * vue, noyée dans ses propres avertissements.
 */

const H1 = dureeSecondes('H1');
/** Mercredi 2026-07-22 00:00:00 UTC, en pleine semaine de cotation. */
const MERCREDI = Math.floor(Date.UTC(2026, 6, 22) / 1000);
const MAINTENANT = MERCREDI + 30 * 86_400;

function serie(nombre: number, depart = MERCREDI, prix = 1.08): Chandelier[] {
  return Array.from({ length: nombre }, (_, index) => ({
    horodatage: depart + index * H1,
    ouverture: prix,
    haut: prix + 0.001,
    bas: prix - 0.001,
    cloture: prix,
    volume: 1000,
  }));
}

function codes(chandeliers: Chandelier[], classeActif?: 'FOREX' | 'CRYPTO'): CodeAnomalie[] {
  return verifierSerie(chandeliers, {
    intervalle: 'H1',
    classeActif,
    maintenant: MAINTENANT,
  }).anomalies.map((anomalie) => anomalie.code);
}

describe('cohérence d’une bougie', () => {
  it('accepte une série saine sans rien signaler', () => {
    expect(codes(serie(24))).toEqual([]);
  });

  it('refuse un haut qui ne couvre pas la clôture', () => {
    const chandeliers = serie(3);
    chandeliers[1] = { ...chandeliers[1]!, haut: 1.05, cloture: 1.09 };
    expect(codes(chandeliers)).toContain('OHLC_INCOHERENT');
  });

  it('refuse un prix nul ou négatif', () => {
    const chandeliers = serie(3);
    chandeliers[1] = { ...chandeliers[1]!, bas: 0, ouverture: 0 };
    expect(codes(chandeliers)).toContain('PRIX_NON_POSITIF');
  });

  it('refuse une bougie postérieure à l’instant de référence', () => {
    const chandeliers = serie(2, MAINTENANT + 10 * H1);
    expect(codes(chandeliers)).toContain('BOUGIE_FUTURE');
  });

  it('signale un horodatage qui ne tombe pas sur une ouverture', () => {
    const chandeliers = serie(2);
    chandeliers[1] = { ...chandeliers[1]!, horodatage: chandeliers[1]!.horodatage + 137 };
    expect(codes(chandeliers)).toContain('HORODATAGE_DESALIGNE');
  });
});

describe('enchaînement', () => {
  it('refuse deux bougies au même horodatage', () => {
    const chandeliers = serie(3);
    chandeliers[2] = { ...chandeliers[2]!, horodatage: chandeliers[1]!.horodatage };
    expect(codes(chandeliers)).toContain('HORODATAGE_DUPLIQUE');
  });

  it('refuse une série mal triée', () => {
    const chandeliers = serie(3);
    const permutee = [chandeliers[0]!, chandeliers[2]!, chandeliers[1]!];
    expect(codes(permutee)).toContain('ORDRE_NON_CHRONOLOGIQUE');
  });

  it('signale un trou en pleine semaine', () => {
    const chandeliers = [...serie(3), ...serie(3, MERCREDI + 10 * H1)];
    expect(codes(chandeliers, 'FOREX')).toContain('TROU');
  });

  it('n’appelle pas trou la fermeture du week-end', () => {
    // Vendredi 22 h UTC → dimanche 22 h UTC : le marché est fermé, pas lacunaire.
    const vendrediSoir = Math.floor(Date.UTC(2026, 6, 24, 20) / 1000);
    const dimancheSoir = Math.floor(Date.UTC(2026, 6, 26, 22) / 1000);
    const chandeliers = [...serie(2, vendrediSoir), ...serie(2, dimancheSoir)];
    expect(codes(chandeliers, 'FOREX')).not.toContain('TROU');
  });

  it('signale le même trou sur une crypto, qui cote en continu', () => {
    const vendrediSoir = Math.floor(Date.UTC(2026, 6, 24, 20) / 1000);
    const dimancheSoir = Math.floor(Date.UTC(2026, 6, 26, 22) / 1000);
    const chandeliers = [...serie(2, vendrediSoir), ...serie(2, dimancheSoir)];
    expect(codes(chandeliers, 'CRYPTO')).toContain('TROU');
  });
});

describe('saut de prix', () => {
  it('signale un recollage de deux référentiels', () => {
    // Le cas XAU/USD : simulation autour de 2 300 aboutée à du réel vers 4 100.
    const chandeliers = [...serie(10, MERCREDI, 2_300), ...serie(10, MERCREDI + 10 * H1, 4_100)];
    expect(codes(chandeliers)).toContain('SAUT_DE_PRIX');
  });

  it('ne signale pas une variation ordinaire', () => {
    const chandeliers = serie(20).map((bougie, index) => ({
      ...bougie,
      ouverture: 1.08 + index * 0.0004,
      cloture: 1.08 + index * 0.0004,
      haut: 1.081 + index * 0.0004,
      bas: 1.079 + index * 0.0004,
    }));
    expect(codes(chandeliers)).not.toContain('SAUT_DE_PRIX');
  });

  it('laisse la série exploitable : un saut s’interprète, il ne se rejette pas', () => {
    const chandeliers = [...serie(10, MERCREDI, 2_300), ...serie(10, MERCREDI + 10 * H1, 4_100)];
    const rapport = verifierSerie(chandeliers, { intervalle: 'H1', maintenant: MAINTENANT });
    expect(rapport.exploitable).toBe(true);
  });
});

describe('verdict et résumé', () => {
  it('déclare inexploitable une série à anomalie bloquante', () => {
    const chandeliers = serie(3);
    chandeliers[1] = { ...chandeliers[1]!, haut: 0.5 };
    const rapport = verifierSerie(chandeliers, { intervalle: 'H1', maintenant: MAINTENANT });
    expect(rapport.exploitable).toBe(false);
    expect(resumerQualite(rapport)).toMatch(/inexploitable/);
  });

  it('ne prétend pas 100 % de couverture sur une série vide', () => {
    const rapport = verifierSerie([], { intervalle: 'H1', maintenant: MAINTENANT });
    expect(rapport.couverture).toBe(0);
    expect(rapport.exploitable).toBe(false);
  });

  it('ne compte pas les week-ends comme des bougies manquantes en Forex', () => {
    // Deux semaines de cotation continue hors week-end : la couverture doit
    // être pleine, alors qu'un calcul naïf sur sept jours annoncerait 71 %.
    const chandeliers: Chandelier[] = [];
    for (let jour = 0; jour < 14; jour += 1) {
      const debut = MERCREDI + jour * 86_400;
      const jourSemaine = new Date(debut * 1000).getUTCDay();
      if (jourSemaine === 0 || jourSemaine === 6) continue;
      chandeliers.push(...serie(24, debut));
    }
    const rapport = verifierSerie(chandeliers, {
      intervalle: 'H1',
      classeActif: 'FOREX',
      maintenant: MAINTENANT,
    });
    expect(rapport.couverture).toBeGreaterThan(0.9);
  });
});
