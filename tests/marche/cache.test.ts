import { describe, expect, it } from 'vitest';

import { lireCache } from '@/lib/marche/cache';

import { fauxClient, type Ligne } from '../aides/faux-supabase';

/**
 * Le cas qui a motivé ces tests est réel : la table `chandeliers` contenait,
 * pour XAU/USD en M5, cent treize bougies simulées autour de 2 300 suivies
 * immédiatement de deux cents bougies réelles autour de 4 100. Servies en une
 * seule série, elles décrivaient un saut de soixante-dix pour cent en cinq
 * minutes — un événement qui n'a jamais eu lieu, mais dont héritaient l'ATR,
 * les moyennes et tous les niveaux proposés aux agents.
 *
 * Le fournisseur de la bougie la plus récente fixe la nature de la série.
 */

const SYMBOLE = 'sym-xauusd';
const M5 = 300;
/** Une bougie M5 close, alignée sur son intervalle. */
const FIN = 1_785_000_000 - (1_785_000_000 % M5);

function bougie(indexDepuisLaFin: number, prix: number, fournisseur: string): Ligne {
  const horodatage = FIN - indexDepuisLaFin * M5;
  return {
    symbole_id: SYMBOLE,
    intervalle: 'M5',
    horodatage: new Date(horodatage * 1000).toISOString(),
    ouverture: prix,
    haut: prix + 1,
    bas: prix - 1,
    cloture: prix,
    volume: 100,
    fournisseur_code: fournisseur,
    recupere_le: new Date(FIN * 1000).toISOString(),
    fermee: true,
  };
}

/** Le faux client ne trie pas : on fournit déjà l'ordre décroissant attendu. */
function serieMelangee(): Ligne[] {
  const reelles = [0, 1, 2].map((index) => bougie(index, 4_100 + index, 'twelvedata'));
  const simulees = [3, 4, 5, 6].map((index) => bougie(index, 2_300 + index, 'mock'));
  return [...reelles, ...simulees];
}

describe('homogénéité des séries en cache', () => {
  it('n’aboute pas des bougies simulées à des bougies réelles', async () => {
    const { client } = fauxClient({ chandeliers: serieMelangee() });
    const lecture = await lireCache(client, SYMBOLE, 'M5', 300, FIN + 60);

    expect(lecture.fournisseur).toBe('twelvedata');
    expect(lecture.chandeliers).toHaveLength(3);
    expect(lecture.chandeliers.every((c) => c.cloture > 4_000)).toBe(true);
  });

  it('ne fabrique aucun écart de prix à la jointure', async () => {
    const { client } = fauxClient({ chandeliers: serieMelangee() });
    const { chandeliers } = await lireCache(client, SYMBOLE, 'M5', 300, FIN + 60);

    // Sans le filtre, un des écarts valait plus de 1 700 points.
    for (let index = 1; index < chandeliers.length; index += 1) {
      const ecart = Math.abs(chandeliers[index]!.cloture - chandeliers[index - 1]!.cloture);
      expect(ecart).toBeLessThan(100);
    }
  });

  it('rend la série tronquée plutôt que complétée par de la simulation', async () => {
    // Trois bougies réelles au lieu des sept demandées : le routeur verra le
    // manque et rappellera le fournisseur. C'est le comportement voulu.
    const { client } = fauxClient({ chandeliers: serieMelangee() });
    const lecture = await lireCache(client, SYMBOLE, 'M5', 300, FIN + 60);
    expect(lecture.chandeliers.length).toBeLessThan(7);
  });

  it('laisse intacte une série entièrement simulée', async () => {
    const simulees = [0, 1, 2, 3].map((index) => bougie(index, 2_300 + index, 'mock'));
    const { client } = fauxClient({ chandeliers: simulees });
    const lecture = await lireCache(client, SYMBOLE, 'M5', 300, FIN + 60);

    expect(lecture.fournisseur).toBe('mock');
    expect(lecture.chandeliers).toHaveLength(4);
  });

  it('tolère deux fournisseurs réels dans la même série', async () => {
    // Twelve Data et Yahoo divergent de quelques points sur un même instrument,
    // pas d'un ordre de grandeur : les recoller reste défendable, et refuser
    // priverait la firme de son historique au moindre changement de source.
    const lignes = [
      bougie(0, 4_100, 'twelvedata'),
      bougie(1, 4_099, 'yahoo'),
      bougie(2, 4_098, 'yahoo'),
    ];
    const { client } = fauxClient({ chandeliers: lignes });
    const lecture = await lireCache(client, SYMBOLE, 'M5', 300, FIN + 60);

    expect(lecture.chandeliers).toHaveLength(3);
  });
});
