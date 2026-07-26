import { describe, expect, it } from 'vitest';

import { debutFenetre, etatDepuisLigne, quotaExpire } from '@/lib/marche/quotas';

const MAINTENANT = new Date('2026-07-24T13:37:42.000Z');

describe('fenêtres de quota', () => {
  it('aligne la fenêtre sur des bornes naturelles, pas sur la première utilisation', () => {
    expect(debutFenetre('MINUTE', MAINTENANT).toISOString()).toBe('2026-07-24T13:37:00.000Z');
    expect(debutFenetre('HEURE', MAINTENANT).toISOString()).toBe('2026-07-24T13:00:00.000Z');
    expect(debutFenetre('JOUR', MAINTENANT).toISOString()).toBe('2026-07-24T00:00:00.000Z');
    expect(debutFenetre('MOIS', MAINTENANT).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('considère un compteur d’hier comme expiré', () => {
    expect(quotaExpire('JOUR', '2026-07-23T22:00:00.000Z', MAINTENANT)).toBe(true);
    expect(quotaExpire('JOUR', '2026-07-24T01:00:00.000Z', MAINTENANT)).toBe(false);
  });
});

describe('état de quota', () => {
  const ligne = {
    code: 'twelvedata',
    quota_limite: 800,
    quota_utilise: 800,
    fenetre_quota: 'JOUR' as const,
    quota_reinitialise_le: '2026-07-24T00:00:00.000Z',
  };

  it('déclare épuisé quand la limite est atteinte dans la fenêtre courante', () => {
    expect(etatDepuisLigne(ligne, MAINTENANT).epuise).toBe(true);
  });

  it('remet le compteur à zéro quand la fenêtre a basculé', () => {
    const etat = etatDepuisLigne(
      { ...ligne, quota_reinitialise_le: '2026-07-23T00:00:00.000Z' },
      MAINTENANT,
    );
    expect(etat.utilise).toBe(0);
    expect(etat.epuise).toBe(false);
  });

  it('ne déclare jamais épuisé un fournisseur sans limite', () => {
    const etat = etatDepuisLigne(
      { ...ligne, quota_limite: null, quota_utilise: 100000 },
      MAINTENANT,
    );
    expect(etat.epuise).toBe(false);
  });
});
