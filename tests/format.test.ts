import { describe, expect, it } from 'vitest';

import { couleurPnl, formaterMonnaie, formaterPourcentage, versNombre } from '@/lib/format';

/**
 * Règle produit : une donnée manquante s'affiche comme manquante. Ces tests
 * existent pour qu'aucune « valeur de repli » à 0 ne se glisse dans le
 * formatage lors d'une refonte future.
 */
describe('formatage sans valeur inventée', () => {
  it('affiche un tiret pour une valeur absente', () => {
    expect(formaterMonnaie(null)).toBe('—');
    expect(formaterMonnaie(undefined)).toBe('—');
    expect(formaterPourcentage(null)).toBe('—');
  });

  it('n’assimile pas zéro à une absence de donnée', () => {
    expect(formaterMonnaie(0)).not.toBe('—');
    expect(formaterPourcentage(0)).toBe('+0.00 %');
  });

  it('convertit les numeric PostgreSQL renvoyés en chaîne', () => {
    expect(versNombre('1234.56')).toBe(1234.56);
    expect(versNombre(0)).toBe(0);
    expect(versNombre(null)).toBeNull();
    expect(versNombre('pas un nombre')).toBeNull();
  });

  it('réserve le vert et le rouge à un P&L non nul', () => {
    expect(couleurPnl(12)).toBe('text-hausse');
    expect(couleurPnl(-12)).toBe('text-baisse');
    expect(couleurPnl(0)).toBe('text-texte-attenue');
    expect(couleurPnl(null)).toBe('text-texte-attenue');
  });
});
