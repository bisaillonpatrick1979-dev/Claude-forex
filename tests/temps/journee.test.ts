import { describe, expect, it } from 'vitest';

import {
  debutJourneeIso,
  debutJourneeLocale,
  FUSEAU_DEFAUT,
  fuseauValide,
  jourLocal,
  libelleFuseau,
} from '@/lib/temps/journee';

/**
 * L'Alberta sert de cas de référence : elle observe l'heure d'été, elle est à
 * six ou sept heures de l'UTC selon la saison, et son minuit local tombe en
 * milieu de journée UTC. Tout ce qui peut mal tourner dans un calcul de
 * journée locale s'y voit.
 */

const ALBERTA = 'America/Edmonton';

describe('journée locale', () => {
  it('situe minuit à 06 h UTC en heure d’été', () => {
    // 27 juillet 2026, 15 h 36 UTC = 09 h 36 à Edmonton (MDT, UTC−6).
    const debut = debutJourneeLocale(ALBERTA, new Date('2026-07-27T15:36:00Z'));
    expect(debut.toISOString()).toBe('2026-07-27T06:00:00.000Z');
  });

  it('situe minuit à 07 h UTC en heure normale', () => {
    // En janvier l'Alberta est en MST, UTC−7.
    const debut = debutJourneeLocale(ALBERTA, new Date('2026-01-15T20:00:00Z'));
    expect(debut.toISOString()).toBe('2026-01-15T07:00:00.000Z');
  });

  it('rattache le début de soirée locale au bon jour', () => {
    // 21 h 00 le 26 juillet à Edmonton, c'est déjà le 27 en UTC. Une journée
    // calée sur l'UTC aurait remis les compteurs à zéro en pleine soirée.
    const instant = new Date('2026-07-27T03:00:00Z');
    expect(jourLocal(ALBERTA, instant)).toBe('2026-07-26');
    expect(debutJourneeLocale(ALBERTA, instant).toISOString()).toBe('2026-07-26T06:00:00.000Z');
  });

  it('ne déplace pas la journée UTC quand le fuseau est UTC', () => {
    const instant = new Date('2026-07-27T15:36:00Z');
    expect(debutJourneeIso('UTC', instant)).toBe('2026-07-27T00:00:00.000Z');
  });

  it('traverse le passage à l’heure d’été sans se décaler', () => {
    // L'Alberta avance ses horloges le 8 mars 2026 à 02 h locales. Le décalage
    // au moment du calcul (UTC−6) diffère de celui qui régnait à minuit
    // (UTC−7) : c'est exactement ce que la seconde passe corrige.
    const debut = debutJourneeLocale(ALBERTA, new Date('2026-03-08T18:00:00Z'));
    expect(debut.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(jourLocal(ALBERTA, debut)).toBe('2026-03-08');
  });

  it('traverse le retour à l’heure normale sans se décaler', () => {
    // Retour le 1er novembre 2026 à 02 h locales.
    const debut = debutJourneeLocale(ALBERTA, new Date('2026-11-01T18:00:00Z'));
    expect(debut.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(jourLocal(ALBERTA, debut)).toBe('2026-11-01');
  });

  it('rend un début de journée cohérent avec le jour local, à toute heure', () => {
    // Propriété générale plutôt qu'exemples choisis : quelle que soit l'heure,
    // l'instant rendu doit appartenir au même jour local que l'instant demandé.
    for (let heure = 0; heure < 24; heure += 1) {
      const instant = new Date(Date.UTC(2026, 6, 27, heure, 30));
      const debut = debutJourneeLocale(ALBERTA, instant);
      expect(jourLocal(ALBERTA, debut)).toBe(jourLocal(ALBERTA, instant));
      expect(debut.getTime()).toBeLessThanOrEqual(instant.getTime());
      // Et jamais plus de 24 h en arrière.
      expect(instant.getTime() - debut.getTime()).toBeLessThan(25 * 3600_000);
    }
  });
});

describe('robustesse du fuseau', () => {
  it('retombe sur l’UTC plutôt que de lever sur un fuseau inconnu', () => {
    expect(fuseauValide('Mars/Olympus_Mons')).toBe(FUSEAU_DEFAUT);
    expect(fuseauValide('')).toBe(FUSEAU_DEFAUT);
    expect(fuseauValide(null)).toBe(FUSEAU_DEFAUT);
    expect(fuseauValide(ALBERTA)).toBe(ALBERTA);
  });

  it('ne fait pas tomber un calcul de journée sur un fuseau invalide', () => {
    const instant = new Date('2026-07-27T15:36:00Z');
    expect(debutJourneeIso('n’importe quoi', instant)).toBe('2026-07-27T00:00:00.000Z');
  });
});

describe('affichage du fuseau', () => {
  it('nomme le décalage au lieu de le laisser deviner', () => {
    const libelle = libelleFuseau(ALBERTA, new Date('2026-07-27T15:36:00Z'));
    expect(libelle).toContain(ALBERTA);
    expect(libelle).toContain('UTC−06:00');
  });

  it('suit le changement de saison', () => {
    expect(libelleFuseau(ALBERTA, new Date('2026-01-15T20:00:00Z'))).toContain('UTC−07:00');
  });
});
