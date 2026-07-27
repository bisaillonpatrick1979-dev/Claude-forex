import { describe, expect, it } from 'vitest';

import {
  bougiesApres,
  departRejeu,
  fenetreSimulee,
  nombreBougies,
  profondeurMaximaleJours,
} from '@/lib/marche/historique';
import { dureeSecondes } from '@/lib/marche/intervalles';

/**
 * Le rejeu n'a d'intérêt que s'il est reproductible : deux passages sur la
 * même période doivent rendre exactement les mêmes bougies, sinon on ne peut
 * rien comparer d'un essai à l'autre.
 */

const DEMANDE = {
  symbole: 'EURUSD',
  classeActif: 'FOREX' as const,
  intervalle: 'H1' as const,
  jusqua: 1_700_000_000,
  limite: 200,
};

describe('fenêtres simulées', () => {
  it('rend deux fois la même série pour la même fenêtre', () => {
    expect(fenetreSimulee(DEMANDE)).toEqual(fenetreSimulee(DEMANDE));
  });

  it('recolle sans discontinuité deux fenêtres qui se chevauchent', () => {
    // Les prix viennent de l'index absolu de la bougie : une bougie donnée a
    // la même valeur qu'on l'atteigne par une fenêtre ou par l'autre.
    const large = fenetreSimulee({ ...DEMANDE, limite: 200 });
    const etroite = fenetreSimulee({ ...DEMANDE, limite: 50 });

    const communes = large.slice(-50);
    expect(communes).toEqual(etroite);
  });

  it('remonte quinze ans en arrière sans rien inventer d’instable', () => {
    const ancien = fenetreSimulee({
      ...DEMANDE,
      jusqua: 1_700_000_000 - 15 * 365 * 86_400,
      limite: 10,
    });

    expect(ancien).toHaveLength(10);
    expect(ancien.every((bougie) => bougie.haut >= bougie.bas)).toBe(true);
    expect(ancien.every((bougie) => Number.isFinite(bougie.cloture))).toBe(true);
  });

  it('produit des bougies chronologiques et jointives', () => {
    const serie = fenetreSimulee({ ...DEMANDE, limite: 20 });
    const duree = dureeSecondes('H1');

    for (let index = 1; index < serie.length; index += 1) {
      expect(serie[index]!.horodatage - serie[index - 1]!.horodatage).toBe(duree);
    }
  });

  it('respecte la cohérence OHLC', () => {
    for (const bougie of fenetreSimulee({ ...DEMANDE, limite: 40 })) {
      expect(bougie.haut).toBeGreaterThanOrEqual(Math.max(bougie.ouverture, bougie.cloture));
      expect(bougie.bas).toBeLessThanOrEqual(Math.min(bougie.ouverture, bougie.cloture));
    }
  });
});

describe('progression du curseur', () => {
  it('ne rend que les bougies strictement postérieures au curseur', () => {
    const serie = fenetreSimulee({ ...DEMANDE, limite: 10 });
    const curseur = serie[4]!.horodatage;
    const suite = bougiesApres(serie, curseur, 100);

    expect(suite[0]!.horodatage).toBeGreaterThan(curseur);
    expect(suite).toHaveLength(5);
  });

  it('respecte le maximum demandé', () => {
    const serie = fenetreSimulee({ ...DEMANDE, limite: 50 });
    expect(bougiesApres(serie, 0, 7)).toHaveLength(7);
  });

  it('compte les bougies entre deux instants', () => {
    expect(nombreBougies(0, 86_400, 'H1')).toBe(24);
    expect(nombreBougies(86_400, 0, 'H1')).toBe(0);
  });

  it('aligne le départ sur une ouverture de bougie', () => {
    const depart = departRejeu('H1', 365, 1_700_003_600);
    expect(depart % dureeSecondes('H1')).toBe(0);
  });
});

describe('profondeur annoncée', () => {
  it('promet quinze ans en simulé, quel que soit l’intervalle', () => {
    expect(profondeurMaximaleJours('M1', 'SIMULE')).toBe(15 * 365);
    expect(profondeurMaximaleJours('D1', 'SIMULE')).toBe(15 * 365);
  });

  it('reste prudente sur les données réelles en intraday', () => {
    // Aucun palier gratuit ne sert quinze ans de M1 : mieux vaut annoncer un
    // mois et le tenir que promettre quinze ans et rendre trois jours.
    expect(profondeurMaximaleJours('M1', 'FOURNISSEUR')).toBeLessThan(60);
    expect(profondeurMaximaleJours('D1', 'FOURNISSEUR')).toBeGreaterThan(3_000);
  });
});
