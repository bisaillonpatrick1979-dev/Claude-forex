import { describe, expect, it } from 'vitest';

import { profitPerte } from '@/lib/execution/couts';
import { creerOrdre, traiterBougie } from '@/lib/execution/moteur';
import type { Ecriture, EtatMoteur, Evenement } from '@/lib/execution/types';

import { ETAT_NEUF, EURUSD, bougie, contexte } from '../aides/instruments';

/**
 * Scénario complet sur plusieurs bougies : entrées, sortie sur stop, sortie sur
 * cible, portage de nuit. On vérifie que le grand livre reconstitue le solde
 * exactement — c'est la définition opérationnelle de « comptabilité exacte au
 * centime ».
 *
 * L'invariant vaut aussi pour le backtest : c'est la même fonction qui tourne.
 */

const DEBUT = Math.floor(Date.UTC(2026, 6, 28, 18, 0, 0) / 1000);
const PAS = 3600;

function ordre(sens: 'ACHAT' | 'VENTE', decision: number, stop: number, cible: number | null) {
  return creerOrdre({
    instrument: 'EURUSD',
    sens,
    type: 'MARCHE',
    quantite: 1,
    prixDemande: null,
    stopLoss: stop,
    takeProfit: cible,
    horodatageDecision: decision,
    valideJusqua: null,
  });
}

describe('scénario multi-bougies', () => {
  it('boucle le grand livre au centime de bout en bout', () => {
    // Séquence : achat rempli, cible touchée, vente rempli, stop touché,
    // le tout en traversant un rollover à 22:00 UTC.
    const serie = [
      bougie(DEBUT, 1.08, 1.0805, 1.0795, 1.08),
      bougie(DEBUT + PAS, 1.0801, 1.0812, 1.0799, 1.081), // remplissage achat
      bougie(DEBUT + 2 * PAS, 1.0811, 1.0865, 1.0808, 1.086), // cible achat touchée
      bougie(DEBUT + 3 * PAS, 1.086, 1.0862, 1.0855, 1.0858),
      bougie(DEBUT + 4 * PAS, 1.0858, 1.086, 1.0850, 1.0852), // 22:00 UTC → portage
      bougie(DEBUT + 5 * PAS, 1.0852, 1.0856, 1.0795, 1.0798), // cible vente touchée
    ];

    let etat: EtatMoteur = {
      ...ETAT_NEUF,
      ordres: [ordre('ACHAT', DEBUT, 1.0750, 1.0860)],
    };

    const ecritures: Ecriture[] = [];
    const evenements: Evenement[] = [];

    serie.forEach((chandelier, index) => {
      // Vente décidée sur la bougie courante : elle ne pourra donc être
      // remplie qu'à la suivante, et sera portée à travers le rollover.
      if (index === 2) {
        etat = {
          ...etat,
          ordres: [...etat.ordres, ordre('VENTE', chandelier.horodatage, 1.09, 1.08)],
        };
      }

      const resultat = traiterBougie(etat, contexte(chandelier));
      etat = resultat.etat;
      ecritures.push(...resultat.ecritures);
      evenements.push(...resultat.evenements);
    });

    // Le scénario doit réellement avoir produit les événements attendus,
    // sinon le test passerait pour de mauvaises raisons.
    expect(evenements.filter((e) => e.type === 'POSITION_OUVERTE')).toHaveLength(2);
    expect(evenements.filter((e) => e.motif === 'TAKE_PROFIT')).toHaveLength(2);
    expect(evenements.some((e) => e.type === 'SWAP_APPLIQUE')).toBe(true);

    // 1. Le solde final est exactement la somme des écritures.
    const somme = ecritures.reduce((total, ecriture) => total + ecriture.montant, 0);
    expect(100_000 + somme).toBeCloseTo(etat.portefeuille.solde, 8);

    // 2. Chaque écriture porte le solde résultant, dans l'ordre.
    let courant = 100_000;
    for (const ecriture of ecritures) {
      courant += ecriture.montant;
      expect(ecriture.soldeApres).toBeCloseTo(courant, 8);
    }

    // 3. Sans position ouverte à la fin, équité = solde et marge = 0.
    expect(etat.positions).toHaveLength(0);
    expect(etat.portefeuille.equite).toBeCloseTo(etat.portefeuille.solde, 8);
    expect(etat.portefeuille.margeUtilisee).toBeCloseTo(0, 8);
  });

  it('maintient équité = solde + latent tant qu’une position est ouverte', () => {
    const etatInitial: EtatMoteur = {
      ...ETAT_NEUF,
      ordres: [ordre('ACHAT', DEBUT, 1.0700, null)],
    };

    const apres = traiterBougie(
      etatInitial,
      contexte(bougie(DEBUT + PAS, 1.08, 1.0810, 1.0795, 1.0805)),
    );

    const position = apres.etat.positions[0]!;
    const latent = profitPerte(EURUSD, 'ACHAT', position.quantite, position.prixEntree, 1.0805, 1);

    expect(apres.etat.portefeuille.equite).toBeCloseTo(
      apres.etat.portefeuille.solde + latent,
      8,
    );
  });

  it('ne fait jamais redescendre le sommet d’équité', () => {
    let etat: EtatMoteur = { ...ETAT_NEUF, ordres: [ordre('ACHAT', DEBUT, 1.0700, null)] };

    for (const chandelier of [
      bougie(DEBUT + PAS, 1.08, 1.0810, 1.0795, 1.0805),
      bougie(DEBUT + 2 * PAS, 1.0805, 1.0900, 1.0800, 1.0895), // fort gain latent
      bougie(DEBUT + 3 * PAS, 1.0895, 1.0900, 1.0750, 1.0755), // repli
    ]) {
      etat = traiterBougie(etat, contexte(chandelier)).etat;
    }

    expect(etat.portefeuille.sommetEquite).toBeGreaterThan(etat.portefeuille.equite);
    expect(etat.portefeuille.sommetEquite).toBeGreaterThan(100_000);
  });
});
