import { describe, expect, it } from 'vitest';

import {
  prochaineOuverture,
  seanceAutorisee,
  seancesOuvertes,
  weekEndForex,
  type CodeSeance,
} from '@/lib/marche/seances-mondiales';

/**
 * Les séances décident quand les agents ont le droit de travailler. Une erreur
 * ici les fait soit trader dans un marché fin — spreads larges, stops touchés
 * par le bruit — soit rester muets alors que Londres est ouverte.
 *
 * Repères UTC : lundi 2026-07-27. 1 785 110 400 = lundi 00 h 00 UTC.
 */

const LUNDI_MINUIT = 1_785_110_400;
const heure = (h: number, jourDecale = 0) => LUNDI_MINUIT + jourDecale * 86_400 + h * 3_600;

describe('repère de départ', () => {
  it('pointe bien un lundi à minuit UTC', () => {
    const date = new Date(LUNDI_MINUIT * 1000);
    expect(date.getUTCDay()).toBe(1);
    expect(date.getUTCHours()).toBe(0);
  });
});

describe('séances ouvertes', () => {
  it('ouvre Tokyo la nuit européenne', () => {
    expect(seancesOuvertes(heure(2))).toContain('TOKYO');
    expect(seancesOuvertes(heure(2))).not.toContain('LONDRES');
  });

  it('reconnaît le chevauchement Londres–New York, le plus liquide de la journée', () => {
    const ouvertes = seancesOuvertes(heure(14));
    expect(ouvertes).toContain('LONDRES');
    expect(ouvertes).toContain('NEW_YORK');
  });

  it('garde Sydney ouverte de part et d’autre de minuit', () => {
    // La séance franchit le changement de jour : 22 h et 3 h sont toutes deux
    // dedans, ce qu'une comparaison naïve « début ≤ t < fin » raterait.
    expect(seancesOuvertes(heure(22))).toContain('SYDNEY');
    expect(seancesOuvertes(heure(3))).toContain('SYDNEY');
  });

  it('ne rend rien pendant le week-end', () => {
    expect(seancesOuvertes(heure(12, 5))).toEqual([]); // samedi midi
  });
});

describe('week-end du marché des changes', () => {
  it('ferme du vendredi 22 h au dimanche 21 h UTC', () => {
    expect(weekEndForex(heure(21, 4))).toBe(false); // vendredi 21 h : encore ouvert
    expect(weekEndForex(heure(23, 4))).toBe(true); // vendredi 23 h : fermé
    expect(weekEndForex(heure(12, 5))).toBe(true); // samedi
    expect(weekEndForex(heure(12, 6))).toBe(true); // dimanche midi
    expect(weekEndForex(heure(22, 6))).toBe(false); // dimanche 22 h : rouvert
  });
});

describe('autorisation des agents', () => {
  it('laisse tout passer quand aucune séance n’est choisie', () => {
    // Même convention que le périmètre d'instruments : vide = pas de
    // restriction. L'inverser donnerait deux sémantiques à la même idée.
    const verdict = seanceAutorisee([], heure(3));
    expect(verdict.autorise).toBe(true);
    expect(verdict.raison).toMatch(/aucune restriction/i);
  });

  it('autorise pendant la séance choisie', () => {
    const verdict = seanceAutorisee(['LONDRES'], heure(10));
    expect(verdict.autorise).toBe(true);
    expect(verdict.raison).toMatch(/Londres/);
  });

  it('refuse hors de la séance choisie, en disant laquelle est ouverte', () => {
    const verdict = seanceAutorisee(['NEW_YORK'], heure(2));
    expect(verdict.autorise).toBe(false);
    expect(verdict.raison).toMatch(/Tokyo|Sydney/);
  });

  it('refuse le week-end même sans restriction de séance', () => {
    // Un marché qui ne cote pas n'est pas « une séance fermée parmi d'autres ».
    const verdict = seanceAutorisee([], heure(12, 5));
    expect(verdict.autorise).toBe(false);
    expect(verdict.raison).toMatch(/fermé/i);
  });

  it('accepte dès qu’une seule des séances choisies est ouverte', () => {
    const choix: CodeSeance[] = ['TOKYO', 'NEW_YORK'];
    expect(seanceAutorisee(choix, heure(2)).autorise).toBe(true);
    expect(seanceAutorisee(choix, heure(15)).autorise).toBe(true);
    expect(seanceAutorisee(choix, heure(11)).autorise).toBe(false);
  });
});

describe('prochaine ouverture', () => {
  it('annonce quand la séance choisie rouvrira', () => {
    const instant = prochaineOuverture(['LONDRES'], heure(2));
    expect(instant).not.toBeNull();
    expect(new Date(instant! * 1000).getUTCHours()).toBe(8);
  });

  it('saute le week-end au lieu de rendre une heure morte', () => {
    const instant = prochaineOuverture(['LONDRES'], heure(12, 5));
    expect(instant).not.toBeNull();
    expect(weekEndForex(instant!)).toBe(false);
  });
});
