import { afterEach, describe, expect, it } from 'vitest';

import {
  MODES_AUTORISES,
  exigerModeAutorise,
  modeAutorise,
  modeReelAutorise,
} from '@/lib/config/drapeaux';

/**
 * Le verrou du mode réel est la garantie la plus importante du projet avant la
 * phase 7. On le teste explicitement, y compris avec la variable
 * d'environnement forcée à « true » : la constante en dur doit gagner.
 */
describe('verrou du mode réel', () => {
  const valeurInitiale = process.env.AUTORISER_MODE_REEL;

  afterEach(() => {
    if (valeurInitiale === undefined) {
      delete process.env.AUTORISER_MODE_REEL;
    } else {
      process.env.AUTORISER_MODE_REEL = valeurInitiale;
    }
  });

  it('refuse le mode réel par défaut', () => {
    expect(modeReelAutorise()).toBe(false);
    expect(modeAutorise('REEL_VALIDATION')).toBe(false);
  });

  it('refuse le mode réel même si la variable d’environnement l’autorise', () => {
    process.env.AUTORISER_MODE_REEL = 'true';
    expect(modeReelAutorise()).toBe(false);
    expect(modeAutorise('REEL_VALIDATION')).toBe(false);
  });

  it('lève une exception plutôt que de renvoyer un refus ignorable', () => {
    expect(() => exigerModeAutorise('REEL_VALIDATION')).toThrow(/verrouillé/);
  });

  it('autorise les deux modes papier', () => {
    expect(modeAutorise('PAPIER_AUTONOME')).toBe(true);
    expect(modeAutorise('PAPIER_VALIDATION')).toBe(true);
    expect(() => exigerModeAutorise('PAPIER_AUTONOME')).not.toThrow();
  });

  it('n’expose aucun mode réel dans la liste des modes autorisés', () => {
    expect(MODES_AUTORISES).not.toContain('REEL_VALIDATION');
  });
});
