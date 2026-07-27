import { describe, expect, it } from 'vitest';

import {
  calculerEnveloppe,
  portefeuilleDesAgents,
  raisonIndisponibilite,
  type ResultatAgents,
} from '@/lib/agents/enveloppe';
import type { EtatPortefeuille } from '@/lib/execution/types';

/**
 * L'enveloppe est ce qui empêche « 1 % de risque par trade » de vouloir dire
 * 1 000 $ quand l'utilisateur croyait en risquer 100. Ces tests fixent le
 * comportement attendu, y compris le cas qui compte le plus : aucune
 * allocation = aucune ouverture possible.
 */

const PORTEFEUILLE: EtatPortefeuille = {
  devise: 'USD',
  capitalInitial: 100_000,
  solde: 100_000,
  equite: 100_000,
  margeUtilisee: 0,
  sommetEquite: 100_000,
  gele: false,
};

function resultat(surcharge: Partial<ResultatAgents> = {}): ResultatAgents {
  return {
    alloue: 10_000,
    profitsRealises: 0,
    pertesRealisees: 0,
    latent: 0,
    margeEngagee: 0,
    ...surcharge,
  };
}

describe('calcul de l’enveloppe', () => {
  it('sépare profits et pertes au lieu de ne montrer que le net', () => {
    const enveloppe = calculerEnveloppe(
      resultat({ profitsRealises: 5_000, pertesRealisees: 4_800 }),
    );

    expect(enveloppe.profitsRealises).toBe(5_000);
    expect(enveloppe.pertesRealisees).toBe(4_800);
    expect(enveloppe.netRealise).toBe(200);
    expect(enveloppe.valeurCourante).toBe(10_200);
  });

  it('intègre le latent dans la valeur courante mais pas dans le réalisé', () => {
    const enveloppe = calculerEnveloppe(resultat({ latent: -350 }));

    expect(enveloppe.netRealise).toBe(0);
    expect(enveloppe.valeurCourante).toBe(9_650);
  });

  it('déduit la marge engagée de ce qui reste disponible', () => {
    const enveloppe = calculerEnveloppe(resultat({ margeEngagee: 4_000 }));
    expect(enveloppe.disponible).toBe(6_000);
  });

  it('ne rend pas de pourcentage quand rien n’est alloué, au lieu d’un infini', () => {
    const enveloppe = calculerEnveloppe(resultat({ alloue: 0, profitsRealises: 100 }));
    expect(enveloppe.variationPct).toBeNull();
    expect(enveloppe.actif).toBe(false);
  });

  it('chiffre la variation en pourcentage de l’allocation, latent compris', () => {
    const enveloppe = calculerEnveloppe(
      resultat({ profitsRealises: 800, pertesRealisees: 300, latent: 100 }),
    );
    expect(enveloppe.variationPct).toBeCloseTo(6, 6);
  });
});

describe('portefeuille vu par les agents', () => {
  it('plafonne l’équité à l’enveloppe, pas à celle du compte', () => {
    const vue = portefeuilleDesAgents(PORTEFEUILLE, calculerEnveloppe(resultat()));

    expect(vue.equite).toBe(10_000);
    expect(vue.solde).toBe(10_000);
    // 1 % de risque porte donc sur 10 000, soit 100 — et non 1 000.
    expect(vue.equite * 0.01).toBe(100);
  });

  it('rend une équité nulle sans allocation : défaut fermé', () => {
    const vue = portefeuilleDesAgents(PORTEFEUILLE, calculerEnveloppe(resultat({ alloue: 0 })));
    expect(vue.equite).toBe(0);
  });

  it('n’expose que la marge engagée par les agents', () => {
    const vue = portefeuilleDesAgents(
      { ...PORTEFEUILLE, margeUtilisee: 40_000 },
      calculerEnveloppe(resultat({ margeEngagee: 2_500 })),
    );
    expect(vue.margeUtilisee).toBe(2_500);
  });

  it('ramène le sommet d’équité à l’échelle de l’enveloppe', () => {
    // Sans cela, le contrôle de drawdown comparerait 10 000 à un sommet de
    // 100 000 et refuserait tout dès la première allocation.
    const vue = portefeuilleDesAgents(PORTEFEUILLE, calculerEnveloppe(resultat()));
    expect(vue.sommetEquite).toBe(10_000);
  });

  it('ne laisse jamais l’équité vue dépasser celle du compte', () => {
    // Cas limite : allocation supérieure à l'équité réelle après des pertes du
    // côté manuel. L'enveloppe ne peut pas inventer du capital.
    const vue = portefeuilleDesAgents(
      { ...PORTEFEUILLE, equite: 6_000, solde: 6_000 },
      calculerEnveloppe(resultat({ alloue: 10_000 })),
    );
    expect(vue.equite).toBe(6_000);
  });

  it('suit le sommet quand l’enveloppe a progressé', () => {
    const vue = portefeuilleDesAgents(
      PORTEFEUILLE,
      calculerEnveloppe(resultat({ profitsRealises: 2_000 })),
    );
    expect(vue.equite).toBe(12_000);
    expect(vue.sommetEquite).toBe(12_000);
  });
});

describe('indisponibilité', () => {
  it('explique l’absence d’allocation plutôt que de refuser en silence', () => {
    const message = raisonIndisponibilite(calculerEnveloppe(resultat({ alloue: 0 })));
    expect(message).toMatch(/aucun capital confié/i);
  });

  it('signale une enveloppe épuisée', () => {
    const message = raisonIndisponibilite(
      calculerEnveloppe(resultat({ pertesRealisees: 10_000 })),
    );
    expect(message).toMatch(/épuisée/i);
  });

  it('ne bloque rien quand l’enveloppe est saine', () => {
    expect(raisonIndisponibilite(calculerEnveloppe(resultat()))).toBeNull();
  });
});
