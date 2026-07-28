import { describe, expect, it } from 'vitest';

import { bandesPertinentes, bandesSeances } from '@/lib/graphique/bandes-seances';

const JOUR = 86_400;

function utc(annee: number, mois: number, jour: number, heure = 0): number {
  return Math.floor(Date.UTC(annee, mois, jour, heure, 0, 0) / 1000);
}

/** Mercredi 22 juillet 2026, une journée de semaine complète. */
const MERCREDI = utc(2026, 6, 22);

describe('bandesPertinentes', () => {
  it('accepte les intervalles intrajournaliers', () => {
    for (const intervalle of ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'] as const) {
      expect(bandesPertinentes(intervalle)).toBe(true);
    }
  });

  it('refuse le journalier et l’hebdomadaire : une bougie y couvre toutes les séances', () => {
    expect(bandesPertinentes('D1')).toBe(false);
    expect(bandesPertinentes('W1')).toBe(false);
  });
});

describe('bandesSeances', () => {
  it('couvre la journée avec les quatre séances', () => {
    const bandes = bandesSeances(MERCREDI, MERCREDI + JOUR);
    const codes = new Set(bandes.map((bande) => bande.code));

    expect(codes).toEqual(new Set(['SYDNEY', 'TOKYO', 'LONDRES', 'NEW_YORK']));
  });

  it('borne chaque bande à la fenêtre demandée', () => {
    const debut = MERCREDI + 10 * 3600;
    const fin = MERCREDI + 14 * 3600;
    const bandes = bandesSeances(debut, fin);

    expect(bandes.length).toBeGreaterThan(0);
    for (const bande of bandes) {
      expect(bande.debut).toBeGreaterThanOrEqual(debut);
      expect(bande.fin).toBeLessThanOrEqual(fin);
      expect(bande.fin).toBeGreaterThan(bande.debut);
    }
  });

  it('place Londres de 8 h à 17 h UTC', () => {
    const bandes = bandesSeances(MERCREDI, MERCREDI + JOUR);
    const londres = bandes.find((bande) => bande.code === 'LONDRES')!;

    expect(new Date(londres.debut * 1000).getUTCHours()).toBe(8);
    expect(new Date(londres.fin * 1000).getUTCHours()).toBe(17);
  });

  it('rattrape une séance commencée la veille — sinon un trou à gauche', () => {
    // À 2 h du matin, Sydney est ouverte depuis 21 h la veille.
    const debut = MERCREDI + 2 * 3600;
    const bandes = bandesSeances(debut, debut + 3600);

    expect(bandes.some((bande) => bande.code === 'SYDNEY')).toBe(true);
  });

  it('ne peint rien pendant le week-end', () => {
    // Samedi entier.
    const samedi = utc(2026, 6, 25);
    expect(bandesSeances(samedi, samedi + JOUR)).toEqual([]);
  });

  it('coupe la bande à la fermeture du vendredi soir', () => {
    const vendredi = utc(2026, 6, 24);
    const bandes = bandesSeances(vendredi + 20 * 3600, vendredi + JOUR);

    for (const bande of bandes) {
      // Le marché ferme vendredi 22 h UTC : rien ne doit dépasser.
      expect(bande.fin).toBeLessThanOrEqual(vendredi + 22 * 3600);
    }
  });

  it('rend une liste vide sur une fenêtre absurde plutôt que de peiner', () => {
    expect(bandesSeances(MERCREDI, MERCREDI)).toEqual([]);
    expect(bandesSeances(MERCREDI + 100, MERCREDI)).toEqual([]);
    expect(bandesSeances(Number.NaN, MERCREDI)).toEqual([]);
  });

  it('refuse de peindre une fenêtre de plusieurs mois — l’aplat ne se lirait plus', () => {
    expect(bandesSeances(MERCREDI, MERCREDI + 200 * JOUR)).toEqual([]);
  });

  it('ne rend que des bandes de durée strictement positive', () => {
    const bandes = bandesSeances(MERCREDI - 3 * JOUR, MERCREDI + 3 * JOUR);
    expect(bandes.length).toBeGreaterThan(0);
    for (const bande of bandes) expect(bande.fin).toBeGreaterThan(bande.debut);
  });
});
