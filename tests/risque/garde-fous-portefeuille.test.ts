import { describe, expect, it } from 'vitest';

import type { PositionOuverte } from '@/lib/execution/types';
import { evaluerGardeFous, type EtatRisque, type ParametresRisque } from '@/lib/risque/garde-fous';

import { EURUSD, USDJPY, PORTEFEUILLE_NEUF } from '../aides/instruments';

/**
 * Vérification de bout en bout : le garde-fou raisonne-t-il vraiment sur le
 * risque agrégé, ou l'agrégation reste-t-elle décorative ?
 *
 * Le cas retenu est celui qui distingue les deux arithmétiques : une position
 * qui couvre le portefeuille. La somme naïve la facturait comme n'importe
 * quelle autre ; l'agrégation doit voir qu'elle réduit le risque.
 */

const PARAMETRES: ParametresRisque = {
  risqueMaxParTradePct: 100,
  risqueTotalMaxPct: 2,
  positionsMax: 10,
  // Neutralisés : ce fichier teste le budget agrégé, pas la concentration,
  // qui a ses propres tests.
  partPositionMaxPct: 100,
  partFacteurMaxPct: 100,
  perteJournaliereMaxPct: 100,
  drawdownMaxPct: 100,
  levierMax: 500,
  fenetreEvenementMacroMinutes: 0,
  stopLossObligatoire: true,
};

const MAINTENANT = 1_785_000_000;

function positionOuverte(sens: 'ACHAT' | 'VENTE', quantite: number): PositionOuverte {
  return {
    id: `p-${sens}-${quantite}`,
    instrument: 'EURUSD',
    sens,
    quantite,
    prixEntree: 1.1,
    stopLoss: sens === 'ACHAT' ? 1.09 : 1.11,
    takeProfit: null,
    margeImmobilisee: 0,
    commissionTotale: 0,
    swapTotal: 0,
    ouvertLe: MAINTENANT - 3600,
    dernierSwapLe: null,
  };
}

function etat(positions: readonly PositionOuverte[]): EtatRisque {
  return {
    portefeuille: { ...PORTEFEUILLE_NEUF, equite: 100_000, solde: 100_000 },
    positions: positions.map((position) => ({
      position,
      instrument: EURUSD,
      tauxCotationVersCompte: 1,
      prixCourant: 1.1,
    })),
    equiteDebutJournee: 100_000,
    evenementsMacro: [],
    maintenant: MAINTENANT,
  };
}

function demander(sens: 'ACHAT' | 'VENTE', quantite: number) {
  return {
    instrument: EURUSD,
    sens,
    quantite,
    prixEntree: 1.1,
    stopLoss: sens === 'ACHAT' ? 1.09 : 1.11,
    tauxCotationVersCompte: 1,
  };
}

describe('budget de risque agrégé dans les garde-fous', () => {
  it('autorise une couverture que la somme naïve aurait refusée', () => {
    // Budget : 2 % de 100 000 = 2 000. Une position longue de 1,5 lot risque
    // 0,01 × 100 000 × 1,5 = 1 500. En somme naïve, il resterait 500 — soit
    // 0,5 lot. Mais une vente sur le même instrument **réduit** le risque :
    // l'agrégation doit accorder bien davantage.
    const decision = evaluerGardeFous(
      demander('VENTE', 1),
      etat([positionOuverte('ACHAT', 1.5)]),
      PARAMETRES,
    );

    expect(decision.decision).not.toBe('REFUSE');
    expect(decision.quantiteAutorisee).toBeGreaterThan(0.5);
  });

  it('plafonne une position qui double le pari existant', () => {
    // Même portefeuille, même taille demandée, sens opposé : cette fois la
    // position s'ajoute au risque et doit être ramenée sous le budget.
    const decision = evaluerGardeFous(
      demander('ACHAT', 1),
      etat([positionOuverte('ACHAT', 1.5)]),
      PARAMETRES,
    );

    expect(decision.quantiteAutorisee).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it('publie le ratio de diversification dans le contrôle', () => {
    const decision = evaluerGardeFous(
      demander('ACHAT', 0.1),
      etat([positionOuverte('ACHAT', 1)]),
      PARAMETRES,
    );

    const controle = decision.controles.find((c) => c.code === 'RISQUE_TOTAL');
    expect(controle?.detail).toMatch(/diversification/);
  });

  it('refuse quand le budget agrégé est saturé', () => {
    const decision = evaluerGardeFous(
      demander('ACHAT', 0.5),
      etat([positionOuverte('ACHAT', 2.5)]),
      PARAMETRES,
    );

    expect(decision.decision).toBe('REFUSE');
    expect(decision.raison).toMatch(/consommé|saturé/i);
  });

  it('ne compte pas dans le budget une position sans stop', () => {
    // Sans stop, le risque n'est pas mesurable : l'inclure au petit bonheur
    // fausserait l'agrégat. Le stop obligatoire est contrôlé ailleurs.
    const sansStop = { ...positionOuverte('ACHAT', 2.5), stopLoss: null };
    const decision = evaluerGardeFous(demander('ACHAT', 0.5), etat([sansStop]), PARAMETRES);

    expect(decision.decision).not.toBe('REFUSE');
  });

  it('traite deux instruments décorrélés plus généreusement que deux corrélés', () => {
    // Contrôle croisé : l'agrégation doit dépendre de l'instrument, sinon elle
    // ne fait que reproduire la somme sous un autre nom. On demande large —
    // le garde-fou ne peut que réduire, jamais accorder plus que demandé, et
    // avec une demande d'un lot les deux cas seraient plafonnés à un lot.
    const memeInstrument = evaluerGardeFous(
      demander('ACHAT', 5),
      etat([positionOuverte('ACHAT', 1)]),
      PARAMETRES,
    );

    const etatDecorrele: EtatRisque = {
      ...etat([positionOuverte('ACHAT', 1)]),
      positions: [
        {
          // Stop et taux cohérents avec une cotation à 155 : la position
          // risque le même montant que son homologue EUR/USD, pour que la
          // seule différence testée soit la corrélation.
          position: {
            ...positionOuverte('ACHAT', 1),
            instrument: 'USDJPY',
            prixEntree: 155,
            stopLoss: 153.45,
          },
          instrument: USDJPY,
          tauxCotationVersCompte: 1 / 155,
          prixCourant: 155,
        },
      ],
    };
    const autreInstrument = evaluerGardeFous(demander('ACHAT', 5), etatDecorrele, PARAMETRES);

    expect(autreInstrument.quantiteAutorisee).toBeGreaterThan(memeInstrument.quantiteAutorisee);
  });
});
