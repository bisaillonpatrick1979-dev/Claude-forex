import { describe, expect, it } from 'vitest';

import {
  calculerComparateurs,
  decideurAchatConservation,
  decideurAleatoire,
  verdict,
} from '@/lib/backtest/comparateurs';
import { calculerMetriques, drawdownMax } from '@/lib/backtest/metriques';
import { executerBacktest, type PointEquite, type TradeFerme } from '@/lib/backtest/moteur';
import { dureeSecondes } from '@/lib/marche/intervalles';
import type { Chandelier } from '@/lib/marche/types';

import { EURUSD } from '../aides/instruments';

/**
 * Les métriques existent pour empêcher une seule phrase : « la stratégie a
 * gagné 40 % ». Sans drawdown à côté, sans référence, sans nombre de trades,
 * cette phrase ne permet aucune décision — et c'est pourtant celle que tous
 * les outils de backtest mettent en gros.
 */

const H1 = dureeSecondes('H1');
const JOUR = Math.floor(Date.UTC(2026, 0, 5) / 1000);

function courbe(valeurs: readonly number[]): PointEquite[] {
  return valeurs.map((equite, index) => ({
    horodatage: JOUR + index * H1,
    equite,
    solde: equite,
  }));
}

function trade(resultat: number): TradeFerme {
  return {
    positionId: `p-${resultat}-${Math.random()}`,
    sens: 'ACHAT',
    quantite: 1,
    ouvertLe: JOUR,
    fermeLe: JOUR + H1,
    prixEntree: 1.1,
    prixSortie: 1.1,
    resultat,
    motif: 'FERMETURE_AGENT',
  };
}

describe('drawdown', () => {
  it('mesure la baisse depuis le sommet courant, pas depuis le sommet final', () => {
    // 100 → 150 → 75 → 200. Le creux vaut −50 % du sommet atteint avant lui,
    // pas −62,5 % du sommet final : c'est la douleur réellement traversée.
    expect(drawdownMax(courbe([100, 150, 75, 200]))).toBeCloseTo(50, 6);
  });

  it('rend zéro sur une courbe qui ne baisse jamais', () => {
    expect(drawdownMax(courbe([100, 110, 120]))).toBe(0);
  });
});

describe('métriques', () => {
  it('lit le rendement sur l’équité et non sur le solde', () => {
    const metriques = calculerMetriques(courbe([100_000, 105_000, 120_000]), [], 'H1');
    expect(metriques.rendementPct).toBeCloseTo(20, 6);
  });

  it('refuse d’annualiser une période trop courte', () => {
    // Trois heures de données ne disent rien d'une année. Extrapoler
    // transformerait du bruit en promesse.
    const metriques = calculerMetriques(courbe([100_000, 101_000, 103_000]), [], 'H1');
    expect(metriques.rendementAnnualisePct).toBeNull();
  });

  it('annualise dès que la période le permet', () => {
    const longue = courbe(Array.from({ length: 24 * 60 }, (_, index) => 100_000 + index * 10));
    const metriques = calculerMetriques(longue, [], 'H1');
    expect(metriques.rendementAnnualisePct).not.toBeNull();
  });

  it('chiffre le facteur de profit et le taux de réussite', () => {
    const trades = [trade(300), trade(300), trade(-200), trade(-100)];
    const metriques = calculerMetriques(courbe([100_000, 100_300]), trades, 'H1');

    expect(metriques.tauxReussitePct).toBeCloseTo(50, 6);
    expect(metriques.facteurProfit).toBeCloseTo(2, 6);
    expect(metriques.esperanceParTrade).toBeCloseTo(75, 6);
  });

  it('ne rend pas un facteur de profit infini quand aucune perte n’a eu lieu', () => {
    // Quatre trades gagnants n'établissent rien : afficher « ∞ » ferait passer
    // un échantillon minuscule pour une stratégie parfaite.
    const metriques = calculerMetriques(courbe([100_000, 101_000]), [trade(100)], 'H1');
    expect(metriques.facteurProfit).toBeNull();
  });

  it('compte la pire série de pertes consécutives', () => {
    const trades = [trade(-10), trade(-10), trade(50), trade(-10), trade(-10), trade(-10)];
    expect(calculerMetriques(courbe([100_000]), trades, 'H1').pireSerieDePertes).toBe(3);
  });

  it('ne prétend pas calculer un Sharpe sur une courbe plate', () => {
    const metriques = calculerMetriques(courbe([100_000, 100_000, 100_000]), [], 'H1');
    expect(metriques.sharpe).toBeNull();
  });

  it('pénalise moins la volatilité haussière : Sortino au-dessus de Sharpe', () => {
    // Une stratégie qui monte par à-coups est pénalisée par le Sharpe alors que
    // personne ne se plaint d'une bonne surprise. Le Sortino corrige cela.
    const valeurs = [100_000];
    for (let index = 1; index < 60; index += 1) {
      valeurs.push(valeurs[index - 1]! * (index % 5 === 0 ? 1.03 : 0.999));
    }
    const metriques = calculerMetriques(courbe(valeurs), [], 'H1');
    expect(metriques.sortino!).toBeGreaterThan(metriques.sharpe!);
  });
});

describe('comparateurs', () => {
  function serieHaussiere(nombre: number): Chandelier[] {
    return Array.from({ length: nombre }, (_, index) => {
      const prix = 1.1 + index * 0.0005;
      return {
        horodatage: JOUR + index * H1,
        ouverture: prix,
        haut: prix + 0.0008,
        bas: prix - 0.0008,
        cloture: prix + 0.0004,
        volume: 1000,
      };
    });
  }

  const base = {
    chandeliers: serieHaussiere(400),
    instrument: EURUSD,
    intervalle: 'H1' as const,
    capitalInitial: 100_000,
    echauffement: 20,
  };

  it('produit les deux références, toujours', () => {
    const comparateurs = calculerComparateurs({ base, quantite: 0.5, tradesReference: 10 });
    expect(comparateurs.map((comparateur) => comparateur.code)).toEqual([
      'ACHAT_CONSERVATION',
      'HASARD',
    ]);
  });

  it('fait gagner l’achat-conservation sur un marché qui monte', () => {
    const [conservation] = calculerComparateurs({ base, quantite: 0.5, tradesReference: 10 });
    expect(conservation!.metriques.rendementPct).toBeGreaterThan(0);
    expect(conservation!.metriques.trades).toBe(0); // jamais fermée volontairement
  });

  it('rend un hasard reproductible pour une même graine', () => {
    const a = calculerComparateurs({ base, quantite: 0.5, tradesReference: 12, graine: 7 });
    const b = calculerComparateurs({ base, quantite: 0.5, tradesReference: 12, graine: 7 });
    expect(a[1]!.metriques.rendementPct).toBe(b[1]!.metriques.rendementPct);
  });

  it('rend un hasard différent pour une graine différente', () => {
    const a = calculerComparateurs({ base, quantite: 0.5, tradesReference: 12, graine: 7 });
    const b = calculerComparateurs({ base, quantite: 0.5, tradesReference: 12, graine: 99 });
    expect(a[1]!.metriques.rendementPct).not.toBe(b[1]!.metriques.rendementPct);
  });

  it('fait prendre au hasard un nombre de positions proche de la consigne', () => {
    // Comparer une stratégie à trois cents trades à un hasard qui n'en prend que
    // dix comparerait surtout deux expositions aux frais.
    const resultat = executerBacktest({ ...base, decideur: decideurAleatoire(0.5, 12, 3) });
    expect(resultat.trades.length).toBeGreaterThan(4);
    expect(resultat.trades.length).toBeLessThanOrEqual(12);
  });

  it('n’ouvre qu’une seule position en achat-conservation', () => {
    const resultat = executerBacktest({ ...base, decideur: decideurAchatConservation(0.5) });
    const ouvertures = resultat.evenements.filter((e) => e.type === 'POSITION_OUVERTE');
    expect(ouvertures).toHaveLength(1);
  });
});

describe('verdict', () => {
  const metriques = (rendementPct: number) =>
    calculerMetriques(courbe([100_000, 100_000 * (1 + rendementPct / 100)]), [], 'H1');

  const reference = (nom: string, rendementPct: number) => ({
    code: 'HASARD' as const,
    nom,
    metriques: metriques(rendementPct),
    explication: '',
  });

  it('le dit franchement quand la stratégie perd contre ses références', () => {
    const texte = verdict(metriques(2), [reference('Achat et conservation', 20)]);
    expect(texte).toMatch(/moins bien/);
    expect(texte).toMatch(/sans rien apporter/);
  });

  it('reste prudent même quand la stratégie gagne', () => {
    const texte = verdict(metriques(30), [reference('Achat et conservation', 5)]);
    expect(texte).toMatch(/devance/);
    expect(texte).toMatch(/À confirmer/);
  });

  it('signale un résultat mitigé plutôt que de trancher', () => {
    const texte = verdict(metriques(10), [
      reference('Achat et conservation', 20),
      reference('Stratégie aléatoire', 3),
    ]);
    expect(texte).toMatch(/mitigé/);
  });
});
