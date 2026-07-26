import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chiffrementConfigure, chiffrer, dechiffrer, indiceVisuel } from '@/lib/securite/chiffrement';

const CLE_TEST = randomBytes(32).toString('base64');

describe('chiffrement des clés API', () => {
  const valeurInitiale = process.env.CLE_CHIFFREMENT;

  beforeEach(() => {
    process.env.CLE_CHIFFREMENT = CLE_TEST;
  });

  afterEach(() => {
    if (valeurInitiale === undefined) delete process.env.CLE_CHIFFREMENT;
    else process.env.CLE_CHIFFREMENT = valeurInitiale;
  });

  it('retrouve la valeur d’origine', () => {
    const secret = 'abcd1234efgh5678';
    expect(dechiffrer(chiffrer(secret))).toBe(secret);
  });

  it('ne laisse jamais la valeur en clair dans le texte stocké', () => {
    const secret = 'ma-cle-twelvedata-9999';
    expect(chiffrer(secret)).not.toContain(secret);
  });

  it('produit un texte différent à chaque chiffrement (IV aléatoire)', () => {
    const secret = 'identique';
    expect(chiffrer(secret)).not.toBe(chiffrer(secret));
  });

  /** GCM est authentifié : une valeur trafiquée en base doit être rejetée,
   *  jamais déchiffrée en une clé silencieusement fausse. */
  it('refuse une valeur altérée au lieu de rendre n’importe quoi', () => {
    const stocke = chiffrer('secret-original');
    const morceaux = stocke.split('.');
    const chiffreAltere = Buffer.from(morceaux[3]!, 'base64');
    chiffreAltere[0] = (chiffreAltere[0]! + 1) % 256;
    morceaux[3] = chiffreAltere.toString('base64');

    expect(() => dechiffrer(morceaux.join('.'))).toThrow();
  });

  it('refuse un format ou une version inconnus', () => {
    expect(() => dechiffrer('v2.a.b.c')).toThrow(/format/i);
    expect(() => dechiffrer('pas-du-tout-chiffre')).toThrow();
  });

  it('n’expose que les quatre derniers caractères', () => {
    expect(indiceVisuel('abcdefgh1234')).toBe('••••1234');
    expect(indiceVisuel('ab')).toBe('••••');
  });

  it('signale une configuration absente au lieu de lever plus loin', () => {
    delete process.env.CLE_CHIFFREMENT;
    expect(chiffrementConfigure()).toBe(false);
    process.env.CLE_CHIFFREMENT = 'trop-court';
    expect(chiffrementConfigure()).toBe(false);
  });
});
