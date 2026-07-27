import { describe, expect, it } from 'vitest';

import {
  evaluerPermission,
  fusionnerRisque,
  type ContextePermission,
  type DemandeAgent,
  type PermissionAgent,
} from '@/lib/agents/permissions';
import type { ParametresRisque } from '@/lib/risque/garde-fous';

/**
 * L'autorisation d'agir est un `if` en TypeScript, jamais une phrase dans un
 * mandat. Ces tests sont la preuve qu'un agent ne peut pas s'accorder un droit
 * qu'on ne lui a pas donné, et que le doute se résout toujours en faveur d'une
 * validation humaine.
 */

const MAINTENANT = 1_785_000_000;

const PERMISSION: PermissionAgent = {
  niveau: 'AUTONOME',
  peutOuvrir: true,
  peutFermer: true,
  peutModifierProtections: false,
  tailleMaxLots: null,
  risqueMaxParTradePct: null,
  tradesMaxParJour: null,
  classesAutorisees: [],
  symbolesAutorises: [],
  seuilValidationLots: null,
  confianceMinimale: null,
  validiteValidationMinutes: 30,
  suspenduJusquA: null,
  raisonSuspension: null,
};

function permission(surcharge: Partial<PermissionAgent> = {}): PermissionAgent {
  return { ...PERMISSION, ...surcharge };
}

function demande(surcharge: Partial<DemandeAgent> = {}): DemandeAgent {
  return {
    action: 'OUVERTURE',
    symbole: 'EURUSD',
    classeActif: 'FOREX',
    quantite: 1,
    confiance: 70,
    ...surcharge,
  };
}

function contexte(surcharge: Partial<ContextePermission> = {}): ContextePermission {
  return {
    role: 'GESTIONNAIRE_PORTEFEUILLE',
    agentActif: true,
    modeOperation: 'PAPIER_AUTONOME',
    portefeuilleGele: false,
    tradesAujourdHui: 0,
    maintenant: MAINTENANT,
    ...surcharge,
  };
}

describe('refus francs', () => {
  it('refuse tout quand le portefeuille est gelé', () => {
    const decision = evaluerPermission(demande(), permission(), contexte({ portefeuilleGele: true }));
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.controles[0]?.code).toBe('GEL');
  });

  it('refuse un agent désactivé, même autonome', () => {
    const decision = evaluerPermission(demande(), permission(), contexte({ agentActif: false }));
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.quantiteAutorisee).toBe(0);
  });

  it('refuse un agent suspendu et annonce le temps restant', () => {
    const decision = evaluerPermission(
      demande(),
      permission({ suspenduJusquA: MAINTENANT + 600, raisonSuspension: 'trois pertes de suite' }),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.raison).toContain('10 min');
    expect(decision.raison).toContain('trois pertes de suite');
  });

  it('laisse agir un agent dont la suspension est écoulée', () => {
    const decision = evaluerPermission(
      demande(),
      permission({ suspenduJusquA: MAINTENANT - 1 }),
      contexte(),
    );
    expect(decision.verdict).toBe('AUTONOME');
  });

  it('refuse toute soumission d’agent en mode conseil', () => {
    const decision = evaluerPermission(
      demande(),
      permission(),
      contexte({ modeOperation: 'PAPIER_CONSEIL' }),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.controles.at(-1)?.code).toBe('MODE_CONSEIL');
  });

  it('refuse un observateur', () => {
    const decision = evaluerPermission(demande(), permission({ niveau: 'OBSERVATEUR' }), contexte());
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.raison).toContain('observateur');
  });
});

describe('droits par action', () => {
  it('refuse une ouverture à un agent qui ne peut que fermer', () => {
    const decision = evaluerPermission(
      demande({ action: 'OUVERTURE' }),
      permission({ peutOuvrir: false, peutFermer: true }),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.raison).toContain('ouvrir');
  });

  it('autorise la fermeture à ce même agent', () => {
    const decision = evaluerPermission(
      demande({ action: 'FERMETURE' }),
      permission({ peutOuvrir: false, peutFermer: true }),
      contexte(),
    );
    expect(decision.verdict).toBe('AUTONOME');
  });

  it('refuse le déplacement d’un stop quand le droit n’est pas accordé', () => {
    const decision = evaluerPermission(
      demande({ action: 'MODIFICATION_PROTECTIONS', quantite: 0 }),
      permission(),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.controles.at(-1)?.code).toBe('DROIT_ACTION');
  });

  it('accepte une modification de protections sans taille quand le droit est accordé', () => {
    const decision = evaluerPermission(
      demande({ action: 'MODIFICATION_PROTECTIONS', quantite: 0 }),
      permission({ peutModifierProtections: true }),
      contexte(),
    );
    expect(decision.verdict).toBe('AUTONOME');
  });
});

describe('périmètre', () => {
  it('refuse une classe d’actifs hors périmètre', () => {
    const decision = evaluerPermission(
      demande({ classeActif: 'CRYPTO', symbole: 'BTCUSD' }),
      permission({ classesAutorisees: ['FOREX'] }),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.raison).toContain('CRYPTO');
  });

  it('refuse un symbole hors de la liste blanche', () => {
    const decision = evaluerPermission(
      demande({ symbole: 'NAS100', classeActif: 'INDICE' }),
      permission({ symbolesAutorises: ['EURUSD', 'GBPUSD'] }),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.raison).toContain('NAS100');
  });

  it('ne restreint rien quand les deux listes sont vides', () => {
    const decision = evaluerPermission(
      demande({ symbole: 'BTCUSD', classeActif: 'CRYPTO' }),
      permission(),
      contexte(),
    );
    expect(decision.verdict).toBe('AUTONOME');
  });
});

describe('quotas et confiance', () => {
  it('refuse une ouverture au-delà du quota quotidien', () => {
    const decision = evaluerPermission(
      demande(),
      permission({ tradesMaxParJour: 3 }),
      contexte({ tradesAujourdHui: 3 }),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.raison).toContain('3 / 3');
  });

  it('laisse fermer une position même quand le quota est épuisé', () => {
    const decision = evaluerPermission(
      demande({ action: 'FERMETURE' }),
      permission({ tradesMaxParJour: 3 }),
      contexte({ tradesAujourdHui: 9 }),
    );
    expect(decision.verdict).toBe('AUTONOME');
  });

  it('refuse une proposition sous la confiance minimale', () => {
    const decision = evaluerPermission(
      demande({ confiance: 40 }),
      permission({ confianceMinimale: 60 }),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
  });

  it('refuse une proposition sans confiance quand un minimum est exigé', () => {
    const decision = evaluerPermission(
      demande({ confiance: null }),
      permission({ confianceMinimale: 60 }),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.raison).toContain('sans degré de confiance');
  });
});

describe('taille plafonnée par l’agent', () => {
  it('ramène la taille au plafond de l’agent', () => {
    const decision = evaluerPermission(
      demande({ quantite: 5 }),
      permission({ tailleMaxLots: 0.5 }),
      contexte(),
    );
    expect(decision.verdict).toBe('AUTONOME');
    expect(decision.quantiteAutorisee).toBe(0.5);
    expect(decision.raison).toContain('0.5');
  });

  it('refuse quand le plafond de l’agent tombe sous la taille minimale', () => {
    const decision = evaluerPermission(
      demande({ quantite: 1 }),
      permission({ tailleMaxLots: 0.005 }),
      contexte(),
    );
    expect(decision.verdict).toBe('REFUSE');
    expect(decision.controles.at(-1)?.code).toBe('TAILLE_MINIMALE');
  });
});

describe('autonome ou validation humaine', () => {
  it('exige une validation pour un agent en proposition', () => {
    const decision = evaluerPermission(demande(), permission({ niveau: 'PROPOSITION' }), contexte());
    expect(decision.verdict).toBe('VALIDATION_REQUISE');
    expect(decision.expireLe).toBe(MAINTENANT + 30 * 60);
  });

  it('date l’expiration selon la validité configurée', () => {
    const decision = evaluerPermission(
      demande(),
      permission({ niveau: 'PROPOSITION', validiteValidationMinutes: 5 }),
      contexte(),
    );
    expect(decision.expireLe).toBe(MAINTENANT + 5 * 60);
  });

  it('rétrograde en validation un rôle non exécutant marqué autonome', () => {
    const decision = evaluerPermission(
      demande(),
      permission({ niveau: 'AUTONOME' }),
      contexte({ role: 'ANALYSTE_TECHNIQUE' }),
    );
    expect(decision.verdict).toBe('VALIDATION_REQUISE');
    expect(decision.raison).toContain('ANALYSTE_TECHNIQUE');
  });

  it('impose la validation quand le mode du profil l’exige, malgré l’autonomie', () => {
    const decision = evaluerPermission(
      demande(),
      permission(),
      contexte({ modeOperation: 'PAPIER_VALIDATION' }),
    );
    expect(decision.verdict).toBe('VALIDATION_REQUISE');
    expect(decision.controles.at(-1)?.code).toBe('MODE');
  });

  it('demande une validation au-dessus du seuil de taille, et pas en dessous', () => {
    const bridee = permission({ seuilValidationLots: 0.5 });
    expect(evaluerPermission(demande({ quantite: 1 }), bridee, contexte()).verdict).toBe(
      'VALIDATION_REQUISE',
    );
    expect(evaluerPermission(demande({ quantite: 0.4 }), bridee, contexte()).verdict).toBe(
      'AUTONOME',
    );
  });

  it('applique le plafond de taille avant le seuil de validation', () => {
    // Plafonné à 0,5 lot, l'ordre repasse sous le seuil : il devient autonome
    // au lieu d'attendre une validation pour une taille qui ne sera pas prise.
    const decision = evaluerPermission(
      demande({ quantite: 3 }),
      permission({ tailleMaxLots: 0.5, seuilValidationLots: 0.5 }),
      contexte(),
    );
    expect(decision.verdict).toBe('AUTONOME');
    expect(decision.quantiteAutorisee).toBe(0.5);
  });
});

describe('fusion des plafonds de risque', () => {
  const PARAMETRES: ParametresRisque = {
    risqueMaxParTradePct: 1,
    risqueTotalMaxPct: 5,
    positionsMax: 5,
    partPositionMaxPct: 50,
    partFacteurMaxPct: 50,
    perteJournaliereMaxPct: 3,
    drawdownMaxPct: 15,
    levierMax: 10,
    fenetreEvenementMacroMinutes: 30,
    stopLossObligatoire: true,
  };

  it('retient le plafond de l’agent quand il est plus strict', () => {
    const fusion = fusionnerRisque(PARAMETRES, { risqueMaxParTradePct: 0.25 });
    expect(fusion.risqueMaxParTradePct).toBe(0.25);
  });

  it('ignore un plafond d’agent plus permissif que celui du portefeuille', () => {
    const fusion = fusionnerRisque(PARAMETRES, { risqueMaxParTradePct: 4 });
    expect(fusion.risqueMaxParTradePct).toBe(1);
  });

  it('laisse les paramètres intacts sans plafond propre', () => {
    expect(fusionnerRisque(PARAMETRES, { risqueMaxParTradePct: null })).toEqual(PARAMETRES);
  });
});
