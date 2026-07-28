import { describe, expect, it } from 'vitest';

import { BarWindow } from '@/engine/BarWindow';
import { Clock } from '@/engine/Clock';
import { Engine } from '@/engine/Engine';
import { PaperExecution } from '@/engine/execution/PaperExecution';
import { DEFAULT_CONFIG } from '@/lib/portfolioMath';
import { d } from '@/lib/decimal';
import type { Bar } from '@/types/market';
import type { Order } from '@/types/trading';
import type { TargetPosition } from '@/engine/interfaces';

import { serieSynthetique } from './helpers/series';

/**
 * ═══ LE TEST QUI COMPTE ═══
 *
 * Un moteur qui lit une bougie future produit des résultats magnifiques et
 * entièrement faux. Le défaut ne se voit pas dans les chiffres de sortie : une
 * courbe d'équité qui monte tout droit ressemble à une bonne stratégie. Il ne
 * se détecte que par construction.
 *
 * Ces tests attaquent la garantie par trois angles :
 *
 *   1. Structurel — le contexte remis aux stratégies ne SAIT pas rendre une
 *      bougie postérieure au curseur.
 *   2. Temporel — un ordre décidé sur une clôture ne se remplit jamais à cette
 *      clôture.
 *   3. Comportemental — remplacer tout le futur par n'importe quoi ne change
 *      aucune décision passée. C'est le seul test qui prouve l'absence de
 *      fuite plutôt que l'absence d'un chemin de fuite connu.
 */

const TF = '1h';
const H = 3_600;

describe('barrière structurelle : le contexte ne connaît pas la suite', () => {
  it('ne rend jamais plus que ce qui est révélé', () => {
    const bars = serieSynthetique(50);
    const fenetre = new BarWindow('TEST', TF, bars);

    for (let i = 0; i < bars.length; i += 1) {
      fenetre.advance();
      const ctx = fenetre.context(0);
      // On en demande dix fois trop : on n'obtient que le passé révélé.
      const vues = ctx.history(1_000);
      expect(vues).toHaveLength(i + 1);
      expect(vues[vues.length - 1]?.time).toBe(bars[i]?.time);
    }
  });

  it('la dernière bougie visible est celle du curseur, jamais la suivante', () => {
    const bars = serieSynthetique(20);
    const fenetre = new BarWindow('TEST', TF, bars);

    for (let i = 0; i < bars.length; i += 1) {
      fenetre.advance();
      expect(fenetre.context(0).last()?.time).toBe(bars[i]?.time);
    }
  });

  it('un contexte conservé ne s’élargit pas quand la fenêtre avance', () => {
    // Une stratégie qui garderait le contexte d'une bougie pour l'exploiter à
    // la suivante lirait le futur sans s'en rendre compte. La borne haute est
    // figée à la construction, donc c'est impossible.
    const bars = serieSynthetique(30);
    const fenetre = new BarWindow('TEST', TF, bars);

    fenetre.advance();
    fenetre.advance();
    const fige = fenetre.context(0);
    const avant = fige.history(1_000).length;

    for (let i = 0; i < 10; i += 1) fenetre.advance();

    expect(fige.history(1_000)).toHaveLength(avant);
    expect(fige.last()?.time).toBe(bars[1]?.time);
  });

  it('ne rend rien avant la première bougie', () => {
    const fenetre = new BarWindow('TEST', TF, serieSynthetique(10));
    expect(fenetre.context(0).history(5)).toHaveLength(0);
    expect(fenetre.context(0).last()).toBeUndefined();
  });
});

describe('barrière temporelle : pas de remplissage sur la bougie de décision', () => {
  const cible = (): TargetPosition => ({
    symbol: 'TEST',
    side: 'buy',
    quantity: d(1),
    lotStep: d('0.00001'),
    notional: d(100),
    reason: 'test',
    signal: {
      symbol: 'TEST',
      direction: 'long',
      confidence: 1,
      timestamp: 0,
      reason: 'test',
      features: {},
    },
  });

  const ctx = { config: DEFAULT_CONFIG, timeframe: TF } as const;
  const bougie = (time: number, open: number): Bar => ({
    time,
    open,
    high: open + 1,
    low: open - 1,
    close: open,
    volume: 1,
  });

  it('refuse la bougie qui a produit la décision', () => {
    const execution = new PaperExecution();
    // Décision prise à la clôture de la bougie qui ouvre à 10 h : 11 h.
    execution.submit(cible(), { ...ctx, now: 10 * H + H });

    // La bougie de 10 h ne peut pas remplir un ordre décidé à sa clôture.
    expect(execution.onBar(bougie(10 * H, 100), { ...ctx, now: 11 * H })).toHaveLength(0);
    expect(execution.pending()).toHaveLength(1);
  });

  it('remplit à l’ouverture de la bougie suivante', () => {
    const execution = new PaperExecution();
    execution.submit(cible(), { ...ctx, now: 11 * H });

    const fills = execution.onBar(bougie(11 * H, 200), { ...ctx, now: 12 * H });
    expect(fills).toHaveLength(1);
    // Ouverture de la bougie suivante, dégradée du slippage — jamais la
    // clôture qui a produit la décision.
    const glissement = d(200).pointsDeBase(DEFAULT_CONFIG.slippageBps);
    expect(fills[0]?.price.versTexte(8)).toBe(d(200).plus(glissement).versTexte(8));
  });

  it('le slippage joue toujours contre nous', () => {
    // Un slippage tiré autour de zéro s'annulerait sur un grand nombre de
    // trades et reviendrait à ne pas en avoir.
    const achat = new PaperExecution();
    achat.submit(cible(), { ...ctx, now: 0 });
    const prixAchat = achat.onBar(bougie(H, 100), { ...ctx, now: H })[0]?.price;

    const vente = new PaperExecution();
    vente.submit({ ...cible(), side: 'sell' }, { ...ctx, now: 0 });
    const prixVente = vente.onBar(bougie(H, 100), { ...ctx, now: H })[0]?.price;

    expect(prixAchat?.plusGrandQue(d(100))).toBe(true);
    expect(prixVente?.plusPetitQue(d(100))).toBe(true);
  });

  it('n’applique jamais de frais nuls', () => {
    const execution = new PaperExecution();
    execution.submit(cible(), { ...ctx, now: 0 });
    const fill = execution.onBar(bougie(H, 100), { ...ctx, now: H })[0];
    expect(fill?.fee.estZero()).toBe(false);
    expect(fill?.slippage.estZero()).toBe(false);
  });
});

describe('barrière comportementale : le futur ne change pas le passé', () => {
  /**
   * Le test décisif.
   *
   * Deux séries identiques jusqu'à la bougie k, puis radicalement différentes.
   * Si la moindre décision prise avant k diffère entre les deux passages, c'est
   * qu'une information postérieure a fuité — peu importe par où.
   *
   * Contrairement aux tests structurels, celui-ci ne vérifie pas l'absence d'un
   * chemin de fuite connu : il vérifie l'absence de fuite.
   */
  const K = 220;

  function ordresJusquA(bars: readonly Bar[], limite: number): readonly string[] {
    const moteur = new Engine({
      symbol: 'TEST',
      timeframe: TF,
      bars,
      config: { ...DEFAULT_CONFIG, maxTradesPerHour: 240 },
    });

    const traces: string[] = [];
    moteur.bus.on('order', (ordre: Order) => {
      if (ordre.decidedAt <= limite) {
        traces.push(`${ordre.decidedAt}|${ordre.side}|${ordre.quantity.versTexte(8)}`);
      }
    });
    moteur.run();
    return traces;
  }

  it('des décisions identiques sur un passé identique, quel que soit le futur', () => {
    const commun = serieSynthetique(400, 1);
    const limite = (commun[K - 1]?.time ?? 0) + H;

    // Futur multiplié par cinq : si quoi que ce soit fuit, ça se verra.
    const explose = commun.map((bar, i) =>
      i < K ? bar : { ...bar, open: bar.open * 5, high: bar.high * 5, low: bar.low * 5, close: bar.close * 5 },
    );
    // Futur effondré, dans l'autre sens.
    const effondre = commun.map((bar, i) =>
      i < K ? bar : { ...bar, open: bar.open / 5, high: bar.high / 5, low: bar.low / 5, close: bar.close / 5 },
    );

    const reference = ordresJusquA(commun, limite);
    expect(reference.length).toBeGreaterThan(0);
    expect(ordresJusquA(explose, limite)).toEqual(reference);
    expect(ordresJusquA(effondre, limite)).toEqual(reference);
  });

  it('tronquer la série ne change pas les décisions qu’elle contenait', () => {
    // Version faible du même principe, et la plus proche du direct : en temps
    // réel le futur n'existe pas encore. Les décisions doivent être les mêmes
    // que sur un historique qui, lui, contient la suite.
    const complete = serieSynthetique(400, 7);
    const limite = (complete[K - 1]?.time ?? 0) + H;

    expect(ordresJusquA(complete.slice(0, K), limite)).toEqual(ordresJusquA(complete, limite));
  });
});

describe('horloge', () => {
  it('refuse de reculer', () => {
    // Une horloge qui recule autoriserait à rejouer une décision déjà prise
    // avec ce qu'on a appris depuis.
    const horloge = new Clock();
    horloge.advanceToClose(100 * H, TF);
    expect(() => horloge.advanceToClose(10 * H, TF)).toThrow(/recul interdit/);
  });

  it('place le présent à la clôture de la bougie, pas à son ouverture', () => {
    // Se tromper d'un pas ferait croire au moteur qu'il connaît une bougie une
    // période trop tôt.
    expect(new Clock().advanceToClose(10 * H, TF)).toBe(11 * H);
  });

  it('estampille l’ordre de l’instant réel de la décision', () => {
    // `decidedAt` est la barrière anti-look-ahead côté exécution. S'il pointe
    // une bougie trop tôt, la protection ne tient plus que par l'ordre des
    // lignes du moteur.
    const bars = serieSynthetique(400, 3);
    const moteur = new Engine({
      symbol: 'TEST',
      timeframe: TF,
      bars,
      config: { ...DEFAULT_CONFIG, maxTradesPerHour: 240 },
    });

    let bougieCourante = -1;
    let verifies = 0;
    moteur.bus.on('bar', ({ bar }) => {
      bougieCourante = bar.time;
    });
    moteur.bus.on('order', (ordre: Order) => {
      // Chaque ordre né sur cette bougie porte SA clôture, pas la précédente.
      expect(ordre.decidedAt).toBe(bougieCourante + H);
      verifies += 1;
    });
    moteur.run();

    expect(verifies).toBeGreaterThan(0);
  });
});
