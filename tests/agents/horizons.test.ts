import { describe, expect, it } from 'vitest';

import {
  consignesHorizon,
  evaluerViabilite,
  horizonsViables,
  profilHorizon,
  HORIZONS,
  type Horizon,
} from '@/lib/agents/horizons';
import type { Instrument } from '@/lib/execution/types';

import { EURUSD, NAS100 } from '../aides/instruments';

/**
 * Ce que ces tests protègent n'est pas une préférence de style, c'est une
 * arithmétique : un horizon n'est praticable que si le mouvement visé paie
 * l'aller-retour. C'est le contrôle qui manque à la plupart des systèmes, et
 * c'est ce qui explique les stratégies de scalping magnifiques en backtest et
 * ruineuses en réel — le backtest compte le mouvement, pas la facture.
 */

/** ATR d'environ un pip sur EUR/USD : une séance très calme. */
const ATR_CALME = 0.0001;
/** ATR d'environ vingt pips : une séance ordinaire de Londres. */
const ATR_ORDINAIRE = 0.002;

describe('viabilité par les coûts', () => {
  it('refuse le scalping quand le spread mange le mouvement visé', () => {
    // 1 pip de spread + 14 $ de commission aller-retour contre 1,5 × 1 pip de
    // gain brut : la facture dépasse le gain. Aucune analyse ne rattrape ça.
    const verdict = evaluerViabilite('SCALPING', EURUSD, ATR_CALME, 1);

    expect(verdict.viable).toBe(false);
    expect(verdict.partCouts).toBeGreaterThan(1);
    expect(verdict.explication).toMatch(/ne peut pas payer son aller-retour/);
  });

  it('accepte le scalping quand la volatilité couvre largement la facture', () => {
    const verdict = evaluerViabilite('SCALPING', EURUSD, ATR_ORDINAIRE, 1);

    expect(verdict.viable).toBe(true);
    expect(verdict.partCouts).toBeLessThan(0.25);
  });

  it('rend le swing praticable là où le scalping échoue, quand le portage est bénin', () => {
    // Même instrument, même séance : la cible plus lointaine paie la même
    // facture fixe. C'est le conseil que doit produire le système.
    const sansPortage: Instrument = { ...EURUSD, swapLongPoints: 0, swapCourtPoints: 0 };
    const scalping = evaluerViabilite('SCALPING', sansPortage, 0.0004, 1);
    const swing = evaluerViabilite('SWING', sansPortage, 0.0004, 1);

    expect(scalping.viable).toBe(false);
    expect(swing.partCouts).toBeLessThan(scalping.partCouts);
  });

  it('laisse le portage renverser le classement quand il est punitif', () => {
    // Résultat contre-intuitif et vrai : sur un instrument dont le portage
    // coûte deux pips par nuit, trois nuits de swing pèsent plus lourd que le
    // spread payé une fois. Allonger l'horizon n'améliore pas toujours la
    // facture — c'est exactement ce qu'un système qui ne modélise que le
    // spread ne peut pas voir.
    const scalping = evaluerViabilite('SCALPING', EURUSD, 0.0004, 1);
    const swing = evaluerViabilite('SWING', EURUSD, 0.0004, 1);

    expect(swing.partCouts).toBeGreaterThan(scalping.partCouts);
    expect(swing.viable).toBe(false);
  });

  it('compte les nuits de portage sur les horizons longs, pas sur les courts', () => {
    const intraday = evaluerViabilite('INTRADAY', EURUSD, ATR_ORDINAIRE, 1);
    const position = evaluerViabilite('POSITION', EURUSD, ATR_ORDINAIRE, 1);

    // Le swap est négatif à l'achat sur EUR/USD dans le référentiel de test :
    // il n'entre dans la facture que quand on porte des nuits.
    const surcoutPortage = position.coutAllerRetour - intraday.coutAllerRetour;
    expect(surcoutPortage).toBeGreaterThan(0);
  });

  it('retient le sens le plus défavorable pour le portage', () => {
    // Un instrument créditeur à l'achat et débiteur à la vente ne doit pas
    // passer pour gratuit : on ne sait pas d'avance de quel côté on sera.
    const asymetrique: Instrument = { ...EURUSD, swapLongPoints: 50, swapCourtPoints: -50 };
    const verdict = evaluerViabilite('POSITION', asymetrique, ATR_ORDINAIRE, 1);

    expect(verdict.coutAllerRetour).toBeGreaterThan(
      evaluerViabilite('INTRADAY', asymetrique, ATR_ORDINAIRE, 1).coutAllerRetour,
    );
  });

  it('refuse de trancher quand la volatilité est inconnue', () => {
    // Le pire des cas serait de déclarer viable ce qu'on n'a pas mesuré.
    const verdict = evaluerViabilite('SCALPING', EURUSD, null, 1);
    expect(verdict.viable).toBe(false);
    expect(verdict.explication).toMatch(/impossible de dire/i);
  });

  it('refuse aussi quand le taux de conversion manque', () => {
    expect(evaluerViabilite('SWING', EURUSD, ATR_ORDINAIRE, 0).viable).toBe(false);
  });

  it('juge chaque instrument séparément', () => {
    // Un indice à gros nominal et un cambiste n'ont pas la même facture
    // relative : le verdict doit dépendre de l'instrument, pas d'un réglage.
    const forex = evaluerViabilite('SCALPING', EURUSD, ATR_ORDINAIRE, 1);
    const indice = evaluerViabilite('SCALPING', NAS100, 20, 1);
    expect(forex.partCouts).not.toBe(indice.partCouts);
  });
});

describe('classement des horizons', () => {
  it('évalue les quatre horizons d’un coup', () => {
    const verdicts = horizonsViables(EURUSD, ATR_ORDINAIRE, 1);
    expect(verdicts.map((verdict) => verdict.horizon)).toEqual([...HORIZONS]);
  });

  it('rend les frais moins pesants à mesure que la cible s’éloigne', () => {
    // Hors portage, allonger la cible dilue la facture fixe. C'est la raison
    // structurelle pour laquelle le scalping est le plus exigeant des quatre.
    const sansPortage: Instrument = { ...EURUSD, swapLongPoints: 0, swapCourtPoints: 0 };
    const parts = horizonsViables(sansPortage, ATR_ORDINAIRE, 1).map((v) => v.partCouts);

    for (let index = 1; index < parts.length; index += 1) {
      expect(parts[index]!).toBeLessThan(parts[index - 1]!);
    }
  });
});

describe('cohérence des profils', () => {
  it('ordonne les durées de détention du plus court au plus long', () => {
    const durees = HORIZONS.map((code) => profilHorizon(code).detentionTypiqueMinutes);
    for (let index = 1; index < durees.length; index += 1) {
      expect(durees[index]!).toBeGreaterThan(durees[index - 1]!);
    }
  });

  it('resserre la tolérance aux frais à mesure que l’horizon s’allonge', () => {
    const seuils = HORIZONS.map((code) => profilHorizon(code).partCoutsToleree);
    for (let index = 1; index < seuils.length; index += 1) {
      expect(seuils[index]!).toBeLessThan(seuils[index - 1]!);
    }
  });

  it('vise toujours plus loin que le stop', () => {
    // Un horizon dont la cible est plus proche que le stop exigerait un taux de
    // réussite irréaliste pour être rentable.
    for (const code of HORIZONS) {
      const profil = profilHorizon(code);
      expect(profil.multipleCibleAtr).toBeGreaterThan(profil.multipleStopAtr);
    }
  });

  it('réduit le nombre de trades quotidiens quand l’horizon s’allonge', () => {
    const quotas = HORIZONS.map((code) => profilHorizon(code).tradesMaxParJour);
    for (let index = 1; index < quotas.length; index += 1) {
      expect(quotas[index]!).toBeLessThan(quotas[index - 1]!);
    }
  });
});

describe('consignes remises aux agents', () => {
  it('décrit l’horizon actif et nomme les trois autres', () => {
    const texte = consignesHorizon('SWING');

    expect(texte).toContain('Horizon : SWING');
    expect(texte).toContain('Scalping');
    expect(texte).toContain('Intraday');
    expect(texte).toContain('Position');
  });

  it('chiffre le cadre au lieu de le décrire en mots', () => {
    const texte = consignesHorizon('SCALPING');
    expect(texte).toContain('M1');
    expect(texte).toContain('M15');
    expect(texte).toMatch(/20 ouvertures par jour/);
  });

  it('autorise l’agent à dire qu’un signal relève d’un autre horizon', () => {
    // Sans cette permission explicite, un agent force le signal dans le cadre
    // qu'on lui a donné — c'est ainsi qu'on obtient du swing déguisé en scalp.
    for (const code of HORIZONS) {
      expect(consignesHorizon(code as Horizon)).toMatch(/au lieu de l’adapter de force/);
    }
  });
});
