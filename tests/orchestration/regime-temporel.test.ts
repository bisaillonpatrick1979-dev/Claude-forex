import { describe, expect, it } from 'vitest';

import { dureeSecondes } from '@/lib/marche/intervalles';
import {
  domainesPour,
  raisonRegimeHistorique,
  rechercheAutorisee,
  regimeCycle,
  type ConditionsTemporelles,
} from '@/lib/orchestration/sources';

/**
 * Barrière anti-look-ahead appliquée à l'information.
 *
 * Le moteur interdit déjà à un ordre de se remplir sur une bougie antérieure à
 * sa décision. Sans l'équivalent côté web, un analyste macro lirait les
 * nouvelles d'aujourd'hui en étudiant une bougie de 2015 : le backtest
 * cesserait de mesurer une méthode pour mesurer une mémoire.
 */

const MAINTENANT = 1_785_146_597;

function conditions(surcharge: Partial<ConditionsTemporelles> = {}): ConditionsTemporelles {
  return {
    rejeuActif: false,
    instantanePerime: false,
    horodatageDerniereBougie: MAINTENANT - 60,
    intervalle: 'M5',
    maintenant: MAINTENANT,
    ...surcharge,
  };
}

describe('régime temporel', () => {
  it('reconnaît le temps réel quand la série colle au marché', () => {
    expect(regimeCycle(conditions())).toBe('TEMPS_REEL');
  });

  it('bascule en historique dès qu’un rejeu tourne', () => {
    // Le portefeuille vit dans le passé : aucune information d'aujourd'hui n'a
    // le droit d'entrer, quelle que soit la fraîcheur des bougies servies.
    expect(regimeCycle(conditions({ rejeuActif: true }))).toBe('HISTORIQUE');
  });

  it('bascule en historique sur un instantané périmé', () => {
    expect(regimeCycle(conditions({ instantanePerime: true }))).toBe('HISTORIQUE');
  });

  it('tolère un retard de deux intervalles', () => {
    // Une bougie en cours plus un retard de fournisseur restent du temps réel.
    const retard = dureeSecondes('M5') * 2;
    expect(regimeCycle(conditions({ horodatageDerniereBougie: MAINTENANT - retard }))).toBe(
      'TEMPS_REEL',
    );
  });

  it('refuse un retard de quatre intervalles', () => {
    const retard = dureeSecondes('M5') * 4;
    expect(regimeCycle(conditions({ horodatageDerniereBougie: MAINTENANT - retard }))).toBe(
      'HISTORIQUE',
    );
  });

  it('adapte la tolérance à l’intervalle', () => {
    // Deux heures de retard : normal en H4, anormal en M5.
    const deuxHeures = MAINTENANT - 7_200;
    expect(
      regimeCycle(conditions({ intervalle: 'H4', horodatageDerniereBougie: deuxHeures })),
    ).toBe('TEMPS_REEL');
    expect(
      regimeCycle(conditions({ intervalle: 'M5', horodatageDerniereBougie: deuxHeures })),
    ).toBe('HISTORIQUE');
  });
});

describe('accès au web selon le régime', () => {
  it('coupe le web à tous les rôles en régime historique', () => {
    // Y compris à l'analyste macro, dont c'est pourtant le métier : mieux vaut
    // une analyse macro pauvre qu'un backtest faussé.
    for (const role of ['ANALYSTE_MACRO', 'ANALYSTE_SENTIMENT', 'ANALYSTE_FONDAMENTAL'] as const) {
      expect(rechercheAutorisee(role, 'TEMPS_REEL')).toBe(true);
      expect(rechercheAutorisee(role, 'HISTORIQUE')).toBe(false);
    }
  });

  it('ne rouvre pas le web par la porte des domaines', () => {
    // domainesPour ignore le régime : c'est rechercheAutorisee qui tranche, et
    // l'orchestrateur ne transmet les domaines que si elle a dit oui.
    expect(rechercheAutorisee('ANALYSTE_MACRO', 'HISTORIQUE')).toBe(false);
    expect(domainesPour('ANALYSTE_MACRO').length).toBeGreaterThan(0);
  });
});

describe('explication affichée', () => {
  it('dit pourquoi le web est coupé pendant un rejeu', () => {
    const message = raisonRegimeHistorique(conditions({ rejeuActif: true }));
    expect(message).toMatch(/rejeu/i);
    expect(message).toMatch(/connaître la suite/i);
  });

  it('distingue le cache périmé du retard de série', () => {
    expect(raisonRegimeHistorique(conditions({ instantanePerime: true }))).toMatch(/cache/i);
    expect(
      raisonRegimeHistorique(
        conditions({ horodatageDerniereBougie: MAINTENANT - dureeSecondes('M5') * 6 }),
      ),
    ).toMatch(/minutes/i);
  });

  it('ne dit rien quand tout va bien', () => {
    // Un message « le web est actif » à chaque cycle serait du bruit.
    expect(raisonRegimeHistorique(conditions())).toBeNull();
  });
});
