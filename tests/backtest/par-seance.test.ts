import { describe, expect, it } from 'vitest';

import {
  TRADES_MINIMUM_POUR_CONCLURE,
  resultatsParSeance,
  seancesRemarquables,
} from '@/lib/backtest/par-seance';

/** Mercredi, loin des bornes du week-end. */
function mercrediA(heureUtc: number): number {
  return Math.floor(Date.UTC(2026, 6, 22, heureUtc, 0, 0) / 1000);
}

const TOKYO = mercrediA(7); // Tokyo seule
const LONDRES = mercrediA(10); // Londres seule
const NEW_YORK = mercrediA(18); // New York seule
const SAMEDI = Math.floor(Date.UTC(2026, 6, 25, 12) / 1000);

describe('resultatsParSeance', () => {
  it('rattache chaque trade à sa séance d’ouverture', () => {
    const lignes = resultatsParSeance([
      { ouvertLe: TOKYO, pnl: -10 },
      { ouvertLe: LONDRES, pnl: 100 },
      { ouvertLe: LONDRES, pnl: 50 },
    ]);

    const tokyo = lignes.find((ligne) => ligne.code === 'TOKYO')!;
    const londres = lignes.find((ligne) => ligne.code === 'LONDRES')!;

    expect(tokyo.trades).toBe(1);
    expect(tokyo.pnl).toBe(-10);
    expect(londres.trades).toBe(2);
    expect(londres.pnl).toBe(150);
  });

  it('rend toutes les séances, même vides — une séance sans trade est une information', () => {
    const lignes = resultatsParSeance([{ ouvertLe: LONDRES, pnl: 10 }]);
    const codes = lignes.map((ligne) => ligne.code);

    expect(codes).toContain('SYDNEY');
    expect(codes).toContain('TOKYO');
    expect(codes).toContain('LONDRES');
    expect(codes).toContain('NEW_YORK');
  });

  it('n’ajoute la ligne « hors séance » que si elle contient quelque chose', () => {
    const sans = resultatsParSeance([{ ouvertLe: LONDRES, pnl: 10 }]);
    expect(sans.some((ligne) => ligne.code === 'HORS_SEANCE')).toBe(false);

    const avec = resultatsParSeance([{ ouvertLe: SAMEDI, pnl: 10 }]);
    const horsSeance = avec.find((ligne) => ligne.code === 'HORS_SEANCE');
    expect(horsSeance?.trades).toBe(1);
  });

  it('calcule le taux de réussite sur les seuls trades chiffrés', () => {
    const lignes = resultatsParSeance([
      { ouvertLe: LONDRES, pnl: 10 },
      { ouvertLe: LONDRES, pnl: -5 },
      { ouvertLe: LONDRES, pnl: 20 },
      { ouvertLe: LONDRES, pnl: null },
    ]);

    const londres = lignes.find((ligne) => ligne.code === 'LONDRES')!;
    expect(londres.trades).toBe(4);
    expect(londres.sansResultat).toBe(1);
    expect(londres.tauxReussitePct).toBeCloseTo((2 / 3) * 100, 6);
  });

  it('rend un taux nul plutôt que 0 % quand aucun trade n’est chiffré', () => {
    const lignes = resultatsParSeance([{ ouvertLe: LONDRES, pnl: null }]);
    const londres = lignes.find((ligne) => ligne.code === 'LONDRES')!;

    expect(londres.tauxReussitePct).toBeNull();
    expect(londres.pnl).toBe(0);
  });

  it('un P&L nul compte comme perdant, pas comme gagnant', () => {
    const lignes = resultatsParSeance([
      { ouvertLe: LONDRES, pnl: 0 },
      { ouvertLe: LONDRES, pnl: 10 },
    ]);
    expect(lignes.find((ligne) => ligne.code === 'LONDRES')!.tauxReussitePct).toBe(50);
  });
});

describe('seancesRemarquables', () => {
  const nFois = (n: number, ouvertLe: number, pnl: number) =>
    Array.from({ length: n }, () => ({ ouvertLe, pnl }));

  it('désigne la meilleure et la pire séance au-delà du seuil', () => {
    const lignes = resultatsParSeance([
      ...nFois(TRADES_MINIMUM_POUR_CONCLURE, LONDRES, 20),
      ...nFois(TRADES_MINIMUM_POUR_CONCLURE, TOKYO, -8),
    ]);

    const { meilleure, pire } = seancesRemarquables(lignes);
    expect(meilleure?.code).toBe('LONDRES');
    expect(pire?.code).toBe('TOKYO');
  });

  it('ne conclut rien sous le seuil — désigner une séance sur deux trades, c’est lire du bruit', () => {
    const lignes = resultatsParSeance([
      ...nFois(TRADES_MINIMUM_POUR_CONCLURE - 1, LONDRES, 100),
      ...nFois(TRADES_MINIMUM_POUR_CONCLURE - 1, TOKYO, -100),
    ]);

    expect(seancesRemarquables(lignes)).toEqual({ meilleure: null, pire: null });
  });

  it('ne conclut rien quand une seule séance franchit le seuil', () => {
    const lignes = resultatsParSeance(nFois(TRADES_MINIMUM_POUR_CONCLURE, LONDRES, 20));
    expect(seancesRemarquables(lignes).meilleure).toBeNull();
  });

  it('ne désigne rien quand toutes les séances sont à égalité', () => {
    const lignes = resultatsParSeance([
      ...nFois(TRADES_MINIMUM_POUR_CONCLURE, LONDRES, 10),
      ...nFois(TRADES_MINIMUM_POUR_CONCLURE, NEW_YORK, 10),
    ]);

    expect(seancesRemarquables(lignes)).toEqual({ meilleure: null, pire: null });
  });
});
