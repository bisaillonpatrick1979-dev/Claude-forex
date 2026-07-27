import { describe, expect, it } from 'vitest';

import {
  appelsParJour,
  distanceAuNiveauLePlusProche,
  intervalleObservation,
  INTERVALLE_MAXIMUM_S,
  INTERVALLE_MINIMUM_S,
  volatiliteParMinute,
} from '@/lib/alertes/cadence';

/**
 * Le réglage à défendre : une cadence fixe se trompe dans les deux sens à la
 * fois. Ces tests vérifient que la cadence adaptative resserre là où quelque
 * chose peut arriver et relâche là où rien ne peut arriver — et surtout qu'elle
 * ne rend jamais de valeur non bornée, puisqu'elle décide de la dépense d'un
 * cron.
 */

// EUR/USD : un pip vaut 0,0001, et un pip par minute est une volatilité
// ordinaire en séance européenne.
const PIP = 0.0001;

describe('cadence adaptative', () => {
  it('resserre à la minute quand le cours est collé au niveau', () => {
    const intervalle = intervalleObservation({
      distance: 0.5 * PIP,
      volatiliteParMinute: PIP,
    });
    expect(intervalle).toBe(INTERVALLE_MINIMUM_S);
  });

  it('relâche au maximum quand le niveau est hors de portée', () => {
    // 200 pips à un pip la minute : plus de trois heures de marche. Observer
    // toutes les cinq minutes n'achèterait rien.
    const intervalle = intervalleObservation({
      distance: 200 * PIP,
      volatiliteParMinute: PIP,
    });
    expect(intervalle).toBe(INTERVALLE_MAXIMUM_S);
  });

  it('gradue entre les deux', () => {
    // 20 pips à un pip la minute : vingt minutes de marche, quatre
    // observations avant l'arrivée possible, soit une toutes les cinq minutes.
    const intervalle = intervalleObservation({
      distance: 20 * PIP,
      volatiliteParMinute: PIP,
    });
    expect(intervalle).toBe(300);
  });

  it('resserre quand la volatilité monte, à distance égale', () => {
    const calme = intervalleObservation({ distance: 20 * PIP, volatiliteParMinute: PIP });
    const agite = intervalleObservation({ distance: 20 * PIP, volatiliteParMinute: 4 * PIP });
    expect(agite).toBeLessThan(calme);
    expect(agite).toBe(75);
  });

  it('est monotone : plus loin ne peut jamais vouloir dire plus souvent', () => {
    let precedent = 0;
    for (let pips = 1; pips <= 300; pips += 7) {
      const intervalle = intervalleObservation({
        distance: pips * PIP,
        volatiliteParMinute: PIP,
      });
      expect(intervalle).toBeGreaterThanOrEqual(precedent);
      precedent = intervalle;
    }
  });
});

describe('entrées dégradées', () => {
  it('espace au maximum quand la volatilité est inconnue', () => {
    // Resserrer sur une inconnue dépense le quota sans rien acheter.
    expect(intervalleObservation({ distance: PIP, volatiliteParMinute: 0 })).toBe(
      INTERVALLE_MAXIMUM_S,
    );
    expect(intervalleObservation({ distance: PIP, volatiliteParMinute: -1 })).toBe(
      INTERVALLE_MAXIMUM_S,
    );
    expect(intervalleObservation({ distance: PIP, volatiliteParMinute: Number.NaN })).toBe(
      INTERVALLE_MAXIMUM_S,
    );
  });

  it('reste borné sur une distance absurde', () => {
    // Un NaN ou un Infinity ici arrêterait la surveillance sans le dire.
    for (const distance of [Number.NaN, Number.POSITIVE_INFINITY, -Number.NaN]) {
      const intervalle = intervalleObservation({ distance, volatiliteParMinute: PIP });
      expect(Number.isFinite(intervalle)).toBe(true);
      expect(intervalle).toBeLessThanOrEqual(INTERVALLE_MAXIMUM_S);
    }
  });

  it('traite une distance négative comme sa valeur absolue', () => {
    const dessus = intervalleObservation({ distance: 20 * PIP, volatiliteParMinute: PIP });
    const dessous = intervalleObservation({ distance: -20 * PIP, volatiliteParMinute: PIP });
    expect(dessous).toBe(dessus);
  });

  it('respecte des bornes personnalisées', () => {
    const intervalle = intervalleObservation({
      distance: 1000 * PIP,
      volatiliteParMinute: PIP,
      maximumS: 600,
    });
    expect(intervalle).toBe(600);
  });

  it('ne laisse pas un maximum sous le minimum inverser les bornes', () => {
    const intervalle = intervalleObservation({
      distance: 1000 * PIP,
      volatiliteParMinute: PIP,
      minimumS: 120,
      maximumS: 30,
    });
    expect(intervalle).toBe(120);
  });
});

describe('volatilité par minute', () => {
  it('ramène un ATR de bougie à la minute', () => {
    // ATR de 5 pips sur des bougies M5 → un pip par minute.
    expect(volatiliteParMinute(5 * PIP, 5)).toBeCloseTo(PIP, 12);
  });

  it('rend zéro sur une entrée inexploitable', () => {
    expect(volatiliteParMinute(null, 5)).toBe(0);
    expect(volatiliteParMinute(0, 5)).toBe(0);
    expect(volatiliteParMinute(5 * PIP, 0)).toBe(0);
  });
});

describe('coût quotidien', () => {
  it('chiffre la différence entre deux cadences', () => {
    // C'est l'argument qui décide : 1 152 appels d'écart par jour et par
    // symbole, sur un quota gratuit de 800.
    expect(appelsParJour(60)).toBe(1440);
    expect(appelsParJour(300)).toBe(288);
    expect(appelsParJour(1800)).toBe(48);
    expect(appelsParJour(1440) - appelsParJour(300)).toBe(-228);
  });

  it('rend l’infini sur un intervalle nul', () => {
    expect(appelsParJour(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('distance au niveau le plus proche', () => {
  it('trouve le plus proche des deux côtés', () => {
    expect(distanceAuNiveauLePlusProche(1.09, [1.085, 1.0902, 1.1])).toBeCloseTo(0.0002, 9);
  });

  it('rend null sans niveau armé', () => {
    // Rien à surveiller : l'appelant doit sauter le symbole, pas choisir une
    // cadence par défaut qui dépenserait pour rien.
    expect(distanceAuNiveauLePlusProche(1.09, [])).toBeNull();
  });

  it('ignore les niveaux non finis', () => {
    expect(distanceAuNiveauLePlusProche(1.09, [Number.NaN, 1.091])).toBeCloseTo(0.001, 9);
    expect(distanceAuNiveauLePlusProche(1.09, [Number.NaN])).toBeNull();
  });
});
