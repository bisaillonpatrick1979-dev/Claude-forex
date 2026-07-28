import { describe, expect, it } from 'vitest';

import { dropForming, findGaps, isValidBar, normalizeBars } from '@/data/normalizer';
import { missingRanges } from '@/data/cache';
import type { Bar } from '@/types/market';

/**
 * Le normalizer est la frontière entre le désordre des fournisseurs et les
 * invariants dont le moteur dépend. Ce qui passe ici est trié, dédupliqué et
 * cohérent — ou n'existe pas.
 */

const H = 3_600;
const bar = (time: number, close = 100, extra: Partial<Bar> = {}): Bar => ({
  time,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 10,
  ...extra,
});

describe('validité d’une bougie', () => {
  it('accepte une bougie cohérente', () => {
    expect(isValidBar(bar(H))).toBe(true);
  });

  it('rejette un haut inférieur au bas', () => {
    // Signature d'un fournisseur qui a inversé deux colonnes.
    expect(isValidBar(bar(H, 100, { high: 90, low: 110 }))).toBe(false);
  });

  it('rejette un haut qui ne domine pas la clôture', () => {
    expect(isValidBar(bar(H, 100, { high: 99 }))).toBe(false);
  });

  it('rejette un prix nul, négatif ou non fini', () => {
    expect(isValidBar(bar(H, 100, { open: 0 }))).toBe(false);
    expect(isValidBar(bar(H, 100, { close: -5 }))).toBe(false);
    expect(isValidBar(bar(H, 100, { close: Number.NaN }))).toBe(false);
  });

  it('rejette un volume négatif', () => {
    expect(isValidBar(bar(H, 100, { volume: -1 }))).toBe(false);
  });
});

describe('normalisation', () => {
  it('trie une série arrivée dans le désordre', () => {
    const { bars } = normalizeBars([bar(3 * H), bar(H), bar(2 * H)], '1h');
    expect(bars.map((b) => b.time)).toEqual([H, 2 * H, 3 * H]);
  });

  it('garde la dernière occurrence d’un doublon', () => {
    // Une réémission corrige la précédente : c'est la convention des
    // fournisseurs, et écraser est plus sûr qu'ignorer.
    const { bars, report } = normalizeBars([bar(H, 100), bar(H, 105)], '1h');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.close).toBe(105);
    expect(report.droppedDuplicate).toBe(1);
  });

  it('écarte une bougie incohérente au lieu de la réparer', () => {
    // Deviner une valeur manquante revient à inventer un prix, qui se propage
    // ensuite dans les indicateurs sans laisser de trace.
    const { bars, report } = normalizeBars([bar(H), bar(2 * H, 100, { high: 1 })], '1h');
    expect(bars).toHaveLength(1);
    expect(report.droppedInvalid).toBe(1);
  });

  it('écarte une bougie mal alignée sur le pas', () => {
    // Une bougie horaire à 10 h 03 trahit un décalage de fuseau chez le
    // fournisseur ; la garder désynchroniserait toute la série.
    const { bars, report } = normalizeBars([bar(H), bar(2 * H + 180)], '1h');
    expect(bars).toHaveLength(1);
    expect(report.droppedUnaligned).toBe(1);
  });

  it('tolère un alignement libre quand on le demande', () => {
    // Nécessaire à l'import de fichier : une archive n'est pas toujours alignée.
    const { bars } = normalizeBars([bar(H + 7)], '1h', false);
    expect(bars).toHaveLength(1);
  });
});

describe('bougie en formation', () => {
  it('retire la bougie dont la période n’est pas écoulée', () => {
    // ═══ Barrière anti-look-ahead ═══ Son haut, son bas et sa clôture
    // bougeront encore : la donner au moteur reviendrait à montrer un prix qui
    // n'existe pas.
    const maintenant = 3 * H + 600;
    const gardees = dropForming([bar(H), bar(2 * H), bar(3 * H)], '1h', maintenant);
    expect(gardees.map((b) => b.time)).toEqual([H, 2 * H]);
  });

  it('garde une bougie dont la période vient exactement de s’achever', () => {
    const gardees = dropForming([bar(H)], '1h', 2 * H);
    expect(gardees).toHaveLength(1);
  });
});

describe('trous', () => {
  it('signale un trou sans le combler', () => {
    // Un marché fermé n'a pas de prix : fabriquer une bougie plate ferait
    // croire à une séance calme là où il n'y avait pas de séance.
    const trous = findGaps([bar(H), bar(4 * H)], '1h');
    expect(trous).toHaveLength(1);
    expect(trous[0]?.missing).toBe(2);
  });

  it('ne signale rien sur une série continue', () => {
    expect(findGaps([bar(H), bar(2 * H), bar(3 * H)], '1h')).toHaveLength(0);
  });
});

describe('segments à recharger', () => {
  it('demande tout quand le cache est vide', () => {
    expect(missingRanges([], '1h', H, 5 * H)).toEqual([{ from: H, to: 5 * H }]);
  });

  it('ne demande que les bords manquants', () => {
    // Sur une série d'un an déjà en cache, redemander les dernières bougies
    // doit coûter une requête, pas plusieurs centaines.
    const manquants = missingRanges([bar(2 * H), bar(3 * H)], '1h', H, 5 * H);
    expect(manquants).toEqual([
      { from: H, to: H },
      { from: 4 * H, to: 5 * H },
    ]);
  });

  it('ne redemande pas un trou interne', () => {
    // Redemander éternellement un week-end ferait boucler l'application.
    const manquants = missingRanges([bar(H), bar(4 * H)], '1h', H, 4 * H);
    expect(manquants).toHaveLength(0);
  });
});
