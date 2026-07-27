import { describe, expect, it } from 'vitest';

import {
  niveauLePlusProche,
  niveauxExtension,
  niveauxRetracement,
  RATIOS_EXTENSION,
  RATIOS_RETRACEMENT,
} from '@/lib/graphique/fibonacci';

/**
 * Les ratios n'ont aucune propriété physique : ils agissent parce que tout le
 * monde regarde les mêmes traits. Ces tests verrouillent donc la **convention**,
 * pas une théorie — un 61,8 % placé ailleurs que chez les autres plateformes
 * serait un 61,8 % inutile.
 */

describe('retracement', () => {
  // Mouvement haussier de 100 à 200 : on trace du départ vers l'arrivée.
  const niveaux = niveauxRetracement(100, 200);

  it('place 0 % sur l’arrivée et 100 % sur le départ', () => {
    expect(niveaux.find((n) => n.ratio === 0)!.prix).toBeCloseTo(200, 9);
    expect(niveaux.find((n) => n.ratio === 1)!.prix).toBeCloseTo(100, 9);
  });

  it('place les niveaux intermédiaires à l’intérieur du mouvement', () => {
    expect(niveaux.find((n) => n.ratio === 0.5)!.prix).toBeCloseTo(150, 9);
    expect(niveaux.find((n) => n.ratio === 0.618)!.prix).toBeCloseTo(138.2, 9);
    expect(niveaux.find((n) => n.ratio === 0.382)!.prix).toBeCloseTo(161.8, 9);
  });

  it('fonctionne à l’identique sur un mouvement baissier', () => {
    // De 200 vers 100 : le 61,8 % remonte, il ne descend pas.
    const baissier = niveauxRetracement(200, 100);
    expect(baissier.find((n) => n.ratio === 0)!.prix).toBeCloseTo(100, 9);
    expect(baissier.find((n) => n.ratio === 1)!.prix).toBeCloseTo(200, 9);
    expect(baissier.find((n) => n.ratio === 0.618)!.prix).toBeCloseTo(161.8, 9);
  });

  it('n’est pas commutatif : l’ordre de saisie porte du sens', () => {
    const montant = niveauxRetracement(100, 200).find((n) => n.ratio === 0.236)!.prix;
    const descendant = niveauxRetracement(200, 100).find((n) => n.ratio === 0.236)!.prix;
    expect(montant).not.toBeCloseTo(descendant, 6);
  });

  it('affiche les ratios comme les plateformes', () => {
    const libelles = niveaux.map((n) => n.libelle);
    expect(libelles).toEqual(['0 %', '23,6 %', '38,2 %', '50 %', '61,8 %', '78,6 %', '100 %']);
  });

  it('signale les ratios qui ne viennent pas de la suite', () => {
    expect(niveaux.find((n) => n.ratio === 0.5)!.conventionnel).toBe(true);
    expect(niveaux.find((n) => n.ratio === 0.618)!.conventionnel).toBe(false);
  });

  it('reste ordonné et monotone entre les deux bornes', () => {
    // Propriété utile au rendu : les traits ne doivent jamais se croiser.
    const prix = niveaux.map((n) => n.prix);
    for (let index = 1; index < prix.length; index += 1) {
      expect(prix[index]!).toBeLessThan(prix[index - 1]!);
    }
  });
});

describe('extension', () => {
  const niveaux = niveauxExtension(100, 200);

  it('fait coïncider le ratio 1 avec l’arrivée du mouvement', () => {
    // C'est ce qui permet de superposer retracement et extension sans saut.
    expect(niveaux.find((n) => n.ratio === 1)!.prix).toBeCloseTo(200, 9);
    expect(niveauxRetracement(100, 200).find((n) => n.ratio === 0)!.prix).toBeCloseTo(200, 9);
  });

  it('projette au-delà du mouvement', () => {
    expect(niveaux.find((n) => n.ratio === 1.618)!.prix).toBeCloseTo(261.8, 9);
    expect(niveaux.find((n) => n.ratio === 2.618)!.prix).toBeCloseTo(361.8, 9);
  });

  it('projette vers le bas sur un mouvement baissier', () => {
    const baissier = niveauxExtension(200, 100);
    expect(baissier.find((n) => n.ratio === 1.618)!.prix).toBeCloseTo(38.2, 9);
  });
});

describe('ratios publiés', () => {
  it('couvre la série que les plateformes affichent par défaut', () => {
    expect(RATIOS_RETRACEMENT).toContain(0.236);
    expect(RATIOS_RETRACEMENT).toContain(0.382);
    expect(RATIOS_RETRACEMENT).toContain(0.618);
    expect(RATIOS_RETRACEMENT).toContain(0.786);
    expect(RATIOS_EXTENSION).toContain(1.272);
    expect(RATIOS_EXTENSION).toContain(1.618);
  });

  it('approche 0,618 par le rapport de deux termes de Fibonacci', () => {
    // Contrôle du sens plutôt que de la valeur : 0,618 n'est pas un nombre
    // arbitraire, c'est la limite de F(n)/F(n+1).
    let a = 1;
    let b = 1;
    for (let index = 0; index < 30; index += 1) [a, b] = [b, a + b];
    expect(a / b).toBeCloseTo(0.618, 3);
  });
});

describe('proximité d’un niveau', () => {
  const niveaux = niveauxRetracement(100, 200);

  it('trouve le niveau le plus proche du cours', () => {
    const proche = niveauLePlusProche(139, niveaux, 100);
    expect(proche!.niveau.ratio).toBe(0.618);
    expect(proche!.ecart).toBeCloseTo(0.8, 6);
    expect(proche!.ecartRelatif).toBeCloseTo(0.008, 6);
  });

  it('rapporte l’écart à l’amplitude, pas à une unité de prix', () => {
    // Le même écart absolu ne veut pas dire la même chose selon l'amplitude :
    // c'est ce qui permet d'appliquer un seuil unique à EUR/USD et à NAS100.
    const large = niveauLePlusProche(139, niveaux, 1000);
    expect(large!.ecart).toBeCloseTo(0.8, 6);
    expect(large!.ecartRelatif).toBeCloseTo(0.0008, 6);
  });

  it('rend zéro plutôt qu’un infini quand l’amplitude est nulle', () => {
    const plats = niveauxRetracement(100, 100);
    expect(niveauLePlusProche(100, plats, 0)!.ecartRelatif).toBe(0);
  });

  it('rend null sur une liste vide', () => {
    expect(niveauLePlusProche(139, [], 100)).toBeNull();
  });
});
