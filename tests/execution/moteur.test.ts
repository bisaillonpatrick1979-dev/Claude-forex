import { describe, expect, it } from 'vitest';

import { tauxConversion } from '@/lib/execution/couts';
import { creerOrdre, fermerManuellement, traiterBougie } from '@/lib/execution/moteur';
import { SIMULATION_DEFAUT, type EtatMoteur, type PositionOuverte } from '@/lib/execution/types';

import { ETAT_NEUF, EURUSD, NAS100, USDJPY, bougie, contexte } from '../aides/instruments';

const T0 = 1_785_000_000;
const PAS = 300;

function position(surcharge: Partial<PositionOuverte> = {}): PositionOuverte {
  return {
    id: 'pos-test',
    instrument: 'EURUSD',
    sens: 'ACHAT',
    quantite: 1,
    prixEntree: 1.08,
    stopLoss: 1.075,
    takeProfit: 1.09,
    margeImmobilisee: 3600,
    commissionTotale: 7,
    swapTotal: 0,
    ouvertLe: T0,
    dernierSwapLe: T0,
    ...surcharge,
  };
}

describe('stops et take-profits', () => {
  it('coupe la position quand le stop est touché', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, positions: [position()] };
    const resultat = traiterBougie(etat, contexte(bougie(T0 + PAS, 1.079, 1.0795, 1.0740, 1.0760)));

    expect(resultat.etat.positions).toHaveLength(0);
    const fermeture = resultat.evenements.find((e) => e.type === 'POSITION_FERMEE');
    expect(fermeture?.motif).toBe('STOP_LOSS');
  });

  it('sort à la cible quand elle est touchée', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, positions: [position()] };
    const resultat = traiterBougie(etat, contexte(bougie(T0 + PAS, 1.085, 1.0915, 1.0845, 1.0905)));

    const fermeture = resultat.evenements.find((e) => e.type === 'POSITION_FERMEE');
    expect(fermeture?.motif).toBe('TAKE_PROFIT');
    expect(fermeture?.montant).toBeGreaterThan(0);
  });

  /**
   * Sans données intra-bougie, l'ordre des touches est inconnaissable. Retenir
   * la cible flatterait tous les backtests ; on retient le stop.
   */
  it('retient le stop quand la bougie contient stop ET cible', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, positions: [position()] };
    const resultat = traiterBougie(etat, contexte(bougie(T0 + PAS, 1.08, 1.0920, 1.0730, 1.085)));

    const fermeture = resultat.evenements.find((e) => e.type === 'POSITION_FERMEE');
    expect(fermeture?.motif).toBe('STOP_LOSS');
    expect(fermeture?.montant).toBeLessThan(0);
  });

  /**
   * Le gap est ce qui fait qu'une perte réelle dépasse le risque prévu. Un
   * moteur qui sert toujours au prix du stop sous-estime systématiquement le
   * risque de queue.
   */
  it('sert au prix d’ouverture, pas au stop, en cas de gap défavorable', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, positions: [position()] };
    // Ouverture à 1.0700, bien sous le stop à 1.0750.
    const resultat = traiterBougie(etat, contexte(bougie(T0 + PAS, 1.07, 1.0710, 1.0690, 1.0705)));

    const fermeture = resultat.evenements.find((e) => e.type === 'POSITION_FERMEE');
    expect(fermeture!.prix!).toBeLessThan(1.0705);
    // Perte attendue ≈ (1.07 − 1.08) × 100 000 = −1000, aggravée par le spread.
    expect(fermeture!.montant!).toBeLessThan(-1000);
  });
});

describe('comptabilité', () => {
  it('n’intègre au solde que le résultat réalisé, jamais le latent', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, positions: [position({ stopLoss: null, takeProfit: null })] };
    const resultat = traiterBougie(etat, contexte(bougie(T0 + PAS, 1.085, 1.086, 1.084, 1.0855)));

    expect(resultat.etat.portefeuille.solde).toBe(100_000);
    // Latent = (1.0855 − 1.08) × 100 000 = 550
    expect(resultat.etat.portefeuille.equite).toBeCloseTo(100_550, 6);
  });

  it('boucle la comptabilité au centime sur un aller-retour complet', () => {
    const ordre = creerOrdre({
      instrument: 'EURUSD',
      sens: 'ACHAT',
      type: 'MARCHE',
      quantite: 1,
      prixDemande: null,
      stopLoss: 1.07,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    const ouverture = traiterBougie(
      { ...ETAT_NEUF, ordres: [ordre] },
      contexte(bougie(T0 + PAS, 1.08, 1.081, 1.079, 1.0805)),
    );

    const pos = ouverture.etat.positions[0]!;
    expect(ouverture.etat.portefeuille.solde).toBeCloseTo(100_000 - 7, 8); // commission

    const fermeture = fermerManuellement(
      ouverture.etat,
      pos.id,
      contexte(bougie(T0 + 2 * PAS, 1.0810, 1.0815, 1.0805, 1.0810)),
    );

    // Entrée à l'ouverture + demi-spread, sortie à la clôture − demi-spread.
    const prixSortie = fermeture.evenements.find((e) => e.type === 'POSITION_FERMEE')!.prix!;
    const attendu = (prixSortie - pos.prixEntree) * 100_000;

    expect(fermeture.etat.portefeuille.solde).toBeCloseTo(100_000 - 7 + attendu, 6);
    expect(fermeture.etat.portefeuille.margeUtilisee).toBe(0);

    // Le grand livre doit reconstituer le solde exactement.
    const ecritures = [...ouverture.ecritures, ...fermeture.ecritures];
    const somme = ecritures.reduce((total, ecriture) => total + ecriture.montant, 0);
    expect(100_000 + somme).toBeCloseTo(fermeture.etat.portefeuille.solde, 6);
    expect(ecritures[ecritures.length - 1]!.soldeApres).toBeCloseTo(
      fermeture.etat.portefeuille.solde,
      6,
    );
  });

  /**
   * USD/JPY sur un compte en dollars : sans conversion, un gain de 1000 yens
   * serait compté comme 1000 dollars. Erreur d'un facteur 150.
   */
  it('convertit le résultat depuis la devise de cotation', () => {
    expect(tauxConversion(USDJPY, 150, 'USD')).toBeCloseTo(1 / 150, 10);

    const etat: EtatMoteur = {
      ...ETAT_NEUF,
      positions: [position({ instrument: 'USDJPY', prixEntree: 150.0, stopLoss: null, takeProfit: null })],
    };

    // Le taux se calcule sur le prix courant, pas sur celui de l'entrée :
    // c'est le taux du moment où la conversion a lieu.
    const cloture = 151.0;
    const resultat = traiterBougie(
      etat,
      contexte(bougie(T0 + PAS, 151, 151.2, 150.9, cloture), {
        instrument: USDJPY,
        tauxCotationVersCompte: tauxConversion(USDJPY, cloture, 'USD'),
      }),
    );

    // (151 − 150) × 100 000 = 100 000 JPY ≈ 662,25 USD à 151.
    expect(resultat.etat.portefeuille.equite - 100_000).toBeCloseTo(100_000 / 151, 2);
  });

  it('refuse de compter quoi que ce soit sans taux de conversion connu', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, positions: [position()] };
    const resultat = traiterBougie(
      etat,
      contexte(bougie(T0 + PAS, 1.09, 1.091, 1.089, 1.0905), { tauxCotationVersCompte: null }),
    );

    expect(resultat.etat.portefeuille.equite).toBe(100_000);
    expect(resultat.etat.positions).toHaveLength(1);
  });
});

describe('horaires de séance', () => {
  it('ne remplit pas un ordre hors séance', () => {
    const ordre = creerOrdre({
      instrument: 'NAS100',
      sens: 'ACHAT',
      type: 'MARCHE',
      quantite: 1,
      prixDemande: null,
      stopLoss: 19_000,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    // Dimanche 12:00 UTC — marché actions fermé.
    const dimanche = Math.floor(Date.UTC(2026, 6, 26, 12, 0, 0) / 1000);
    const resultat = traiterBougie(
      { ...ETAT_NEUF, ordres: [ordre] },
      contexte(bougie(dimanche, 19_500, 19_550, 19_450, 19_520), { instrument: NAS100 }),
    );

    expect(resultat.etat.positions).toHaveLength(0);
    expect(resultat.etat.ordres).toHaveLength(1);
  });

  it('remplit pendant la séance', () => {
    const ordre = creerOrdre({
      instrument: 'NAS100',
      sens: 'ACHAT',
      type: 'MARCHE',
      quantite: 1,
      prixDemande: null,
      stopLoss: 19_000,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    // Mardi 15:00 UTC — séance ouverte.
    const mardi = Math.floor(Date.UTC(2026, 6, 28, 15, 0, 0) / 1000);
    const resultat = traiterBougie(
      { ...ETAT_NEUF, ordres: [ordre] },
      contexte(bougie(mardi, 19_500, 19_550, 19_450, 19_520), { instrument: NAS100 }),
    );

    expect(resultat.etat.positions).toHaveLength(1);
  });
});

describe('validité et remplissage partiel', () => {
  it('expire un ordre dont la validité est dépassée', () => {
    const ordre = creerOrdre({
      instrument: 'EURUSD',
      sens: 'ACHAT',
      type: 'LIMITE',
      quantite: 1,
      prixDemande: 1.05,
      stopLoss: 1.04,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: T0 + PAS,
    });

    const resultat = traiterBougie(
      { ...ETAT_NEUF, ordres: [ordre] },
      contexte(bougie(T0 + 2 * PAS, 1.08, 1.081, 1.079, 1.0805)),
    );

    expect(resultat.etat.ordres).toHaveLength(0);
    expect(resultat.evenements.some((e) => e.type === 'ORDRE_EXPIRE')).toBe(true);
  });

  it('remplit partiellement quand la liquidité de la bougie est limitée', () => {
    const ordre = creerOrdre({
      instrument: 'EURUSD',
      sens: 'ACHAT',
      type: 'MARCHE',
      quantite: 5,
      prixDemande: null,
      stopLoss: 1.07,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    const resultat = traiterBougie(
      { ...ETAT_NEUF, ordres: [ordre] },
      contexte(bougie(T0 + PAS, 1.08, 1.081, 1.079, 1.0805), {
        parametres: { ...SIMULATION_DEFAUT, slippageAtr: 0, slippageParLot: 0, liquiditeParBougie: 2 },
      }),
    );

    expect(resultat.etat.positions[0]!.quantite).toBe(2);
    expect(resultat.etat.ordres[0]!.quantiteRemplie).toBe(2);
    expect(resultat.evenements.some((e) => e.type === 'ORDRE_PARTIELLEMENT_REMPLI')).toBe(true);
  });
});

describe('marge et liquidation', () => {
  it('rejette un remplissage quand la marge libre est insuffisante', () => {
    const ordre = creerOrdre({
      instrument: 'EURUSD',
      sens: 'ACHAT',
      type: 'MARCHE',
      quantite: 200, // 200 lots ≈ 21,6 M$ de notionnel, 2,16 M$ de marge à 10:1
      prixDemande: null,
      stopLoss: 1.07,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    const resultat = traiterBougie(
      { ...ETAT_NEUF, ordres: [ordre] },
      contexte(bougie(T0 + PAS, 1.08, 1.081, 1.079, 1.0805)),
    );

    expect(resultat.etat.positions).toHaveLength(0);
    expect(resultat.evenements.some((e) => e.type === 'ORDRE_REJETE')).toBe(true);
  });

  it('liquide la position la plus perdante sous le seuil d’appel de marge', () => {
    const etat: EtatMoteur = {
      portefeuille: {
        ...ETAT_NEUF.portefeuille,
        solde: 5_000,
        equite: 5_000,
        margeUtilisee: 10_800,
        sommetEquite: 100_000,
      },
      ordres: [],
      positions: [
        position({ id: 'p1', prixEntree: 1.09, stopLoss: null, takeProfit: null, margeImmobilisee: 5_400 }),
        position({ id: 'p2', prixEntree: 1.082, stopLoss: null, takeProfit: null, margeImmobilisee: 5_400 }),
      ],
    };

    const resultat = traiterBougie(etat, contexte(bougie(T0 + PAS, 1.08, 1.0805, 1.0795, 1.08)));

    expect(resultat.evenements.some((e) => e.type === 'APPEL_MARGE')).toBe(true);
    // p1 (entrée à 1.09) perd davantage que p2 : c'est elle qui saute.
    const liquidee = resultat.evenements.find((e) => e.motif === 'LIQUIDATION');
    expect(liquidee?.positionId).toBe('p1');
  });
});

describe('frais', () => {
  it('facture la commission à l’ouverture', () => {
    const ordre = creerOrdre({
      instrument: 'EURUSD',
      sens: 'ACHAT',
      type: 'MARCHE',
      quantite: 2,
      prixDemande: null,
      stopLoss: 1.07,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    const resultat = traiterBougie(
      { ...ETAT_NEUF, ordres: [ordre] },
      contexte(bougie(T0 + PAS, 1.08, 1.081, 1.079, 1.0805)),
    );

    expect(resultat.etat.portefeuille.solde).toBeCloseTo(100_000 - 14, 8);
    expect(resultat.ecritures.some((e) => e.type === 'COMMISSION')).toBe(true);
  });

  it('facture le portage au passage de 22:00 UTC, une seule fois', () => {
    const avantRollover = Math.floor(Date.UTC(2026, 6, 28, 21, 0, 0) / 1000);
    const apresRollover = Math.floor(Date.UTC(2026, 6, 28, 23, 0, 0) / 1000);

    const etat: EtatMoteur = {
      ...ETAT_NEUF,
      positions: [position({ stopLoss: null, takeProfit: null, ouvertLe: avantRollover, dernierSwapLe: avantRollover })],
    };

    const premier = traiterBougie(etat, contexte(bougie(apresRollover, 1.08, 1.081, 1.079, 1.08)));
    expect(premier.evenements.some((e) => e.type === 'SWAP_APPLIQUE')).toBe(true);
    // −20 points × 0,00001 × 100 000 × 1 lot = −20 USD
    expect(premier.etat.portefeuille.solde).toBeCloseTo(100_000 - 20, 6);

    const second = traiterBougie(
      premier.etat,
      contexte(bougie(apresRollover + 3600, 1.08, 1.081, 1.079, 1.08)),
    );
    expect(second.evenements.some((e) => e.type === 'SWAP_APPLIQUE')).toBe(false);
    expect(second.etat.portefeuille.solde).toBeCloseTo(100_000 - 20, 6);
  });

  it('exécute toujours en défaveur : achat plus haut, vente plus bas', () => {
    void EURUSD;
    const achat = creerOrdre({
      instrument: 'EURUSD', sens: 'ACHAT', type: 'MARCHE', quantite: 1,
      prixDemande: null, stopLoss: 1.07, takeProfit: null,
      horodatageDecision: T0, valideJusqua: null,
    });
    const vente = creerOrdre({
      instrument: 'EURUSD', sens: 'VENTE', type: 'MARCHE', quantite: 1,
      prixDemande: null, stopLoss: 1.09, takeProfit: null,
      horodatageDecision: T0, valideJusqua: null,
    });

    const b = bougie(T0 + PAS, 1.08, 1.081, 1.079, 1.0805);
    const resAchat = traiterBougie({ ...ETAT_NEUF, ordres: [achat] }, contexte(b));
    const resVente = traiterBougie({ ...ETAT_NEUF, ordres: [vente] }, contexte(b));

    expect(resAchat.etat.positions[0]!.prixEntree).toBeGreaterThan(1.08);
    expect(resVente.etat.positions[0]!.prixEntree).toBeLessThan(1.08);
  });
});
