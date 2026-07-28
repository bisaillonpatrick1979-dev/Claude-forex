import { describe, expect, it } from 'vitest';

import { Decimal, d } from '@/lib/decimal';

/**
 * L'arithmétique monétaire est la fondation de tout le reste : le backtest, le
 * dimensionnement, les frais. Une dérive d'arrondi ne se voit pas sur un trade
 * et fausse tout sur dix mille.
 */

describe('exactitude', () => {
  it('additionne 0,1 et 0,2 sans dérive', () => {
    // Le cas d'école du flottant : 0.1 + 0.2 vaut 0.30000000000000004.
    expect(d(0.1).plus(d(0.2)).versTexte(2)).toBe('0.30');
    expect(d(0.1).plus(d(0.2)).egal(d(0.3))).toBe(true);
  });

  it('reste stable sur dix mille additions', () => {
    // C'est le scénario réel : un solde qui accumule des centaines de frais.
    let total = Decimal.ZERO;
    for (let i = 0; i < 10_000; i += 1) total = total.plus(d('0.07'));
    expect(total.versTexte(2)).toBe('700.00');
  });

  it('accepte une quantité crypto sans l’écraser à zéro', () => {
    // Des « entiers en cents » arrondiraient 0,00042 BTC à 0.
    expect(d('0.00042').versTexte(8)).toBe('0.00042000');
    expect(d(0.00000001).estZero()).toBe(false);
  });

  it('lit un nombre en notation scientifique', () => {
    // (1e-7).toString() rend « 1e-7 », que l’analyseur naïf refuserait.
    expect(d(1e-7).versTexte(8)).toBe('0.00000010');
  });

  it('refuse une entrée illisible plutôt que de rendre zéro', () => {
    expect(() => d('abc')).toThrow();
    expect(() => d(Number.NaN)).toThrow();
  });
});

describe('opérations', () => {
  it('multiplie sans gonfler l’échelle', () => {
    expect(d('1.5').fois(d('2.5')).versTexte(2)).toBe('3.75');
  });

  it('calcule des frais en points de base', () => {
    // 10 bps = 0,10 %. Sur 10 000 $, cela fait 10 $.
    expect(d(10_000).pointsDeBase(10).versTexte(2)).toBe('10.00');
  });

  it('calcule un pourcentage', () => {
    expect(d(10_000).pourcentage(3).versTexte(2)).toBe('300.00');
  });

  it('exige un mode d’arrondi à la division', () => {
    expect(d(10).divisePar(d(3), 'ZERO').versTexte(8)).toBe('3.33333333');
    expect(d(10).divisePar(d(3), 'HAUT').versTexte(8)).toBe('3.33333334');
  });

  it('refuse la division par zéro', () => {
    expect(() => d(1).divisePar(Decimal.ZERO, 'ZERO')).toThrow();
  });
});

describe('arrondi directionnel', () => {
  it('descend une taille de position au pas, jamais au-dessus', () => {
    // Le point qui compte : arrondir une taille vers le haut ferait franchir
    // le plafond de risque qu'on venait de calculer.
    const taille = d('1.987');
    expect(taille.auPas(d('0.01'), 'BAS').versTexte(2)).toBe('1.98');
    expect(taille.auPas(d('0.01'), 'BAS').plusGrandQue(taille)).toBe(false);
  });

  it('arrondit vers moins l’infini, y compris sur un négatif', () => {
    expect(d('-1.987').auPas(d('0.01'), 'BAS').versTexte(2)).toBe('-1.99');
  });

  it('arrondit au plus proche à la demande', () => {
    expect(d(7).divisePar(d(2), 'PROCHE').versTexte(1)).toBe('3.5');
    expect(d('2.5').auPas(Decimal.UN, 'PROCHE').versTexte(0)).toBe('3');
  });
});

describe('comparaison et agrégation', () => {
  it('compare sans passer par le flottant', () => {
    expect(d('0.1').plus(d('0.2')).compare(d('0.3'))).toBe(0);
    expect(d(5).plusGrandQue(d(4))).toBe(true);
    expect(d(-1).estNegatif()).toBe(true);
  });

  it('somme une liste vide sans exploser', () => {
    expect(Decimal.somme([]).estZero()).toBe(true);
  });

  it('rend le minimum et le maximum', () => {
    expect(Decimal.min(d(3), d(7)).versTexte(0)).toBe('3');
    expect(Decimal.max(d(3), d(7)).versTexte(0)).toBe('7');
  });
});

describe('sortie', () => {
  it('n’utilise jamais la notation scientifique', () => {
    expect(d('0.00000001').versTexte()).not.toMatch(/e/i);
    expect(d('123456789.12345678').versTexte()).toBe('123456789.12345678');
  });

  it('sérialise en texte, pas en flottant', () => {
    // Stocker un flottant réintroduirait la dérive au rechargement.
    expect(JSON.parse(JSON.stringify({ v: d('0.1') })).v).toBe('0.10000000');
  });

  it('tronque à l’affichage sans modifier la valeur', () => {
    const valeur = d('1.23456789');
    expect(valeur.versTexte(2)).toBe('1.23');
    expect(valeur.versTexte()).toBe('1.23456789');
  });
});
