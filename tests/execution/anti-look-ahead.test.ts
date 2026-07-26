import { describe, expect, it } from 'vitest';

import { creerOrdre, traiterBougie } from '@/lib/execution/moteur';
import type { EtatMoteur } from '@/lib/execution/types';

import { ETAT_NEUF, bougie, contexte } from '../aides/instruments';

/**
 * ═══ Le test qui compte le plus du projet ═══
 *
 * Le look-ahead bias est le piège numéro un du backtesting : décider en voyant
 * la clôture d'une bougie, puis exécuter à l'ouverture de **cette même**
 * bougie. Le résultat est spectaculaire et entièrement faux, et rien dans
 * l'interface ne le trahit — la courbe d'équité monte, c'est tout.
 *
 * Ces tests verrouillent l'invariant : un ordre décidé sur la bougie N ne peut
 * être rempli qu'à partir de la bougie N+1.
 */

const T0 = 1_785_000_000;
const PAS = 300;

function ordreMarcheDecideEn(horodatage: number) {
  return creerOrdre({
    instrument: 'EURUSD',
    sens: 'ACHAT',
    type: 'MARCHE',
    quantite: 1,
    prixDemande: null,
    stopLoss: 1.07,
    takeProfit: null,
    horodatageDecision: horodatage,
    valideJusqua: null,
  });
}

describe('barrière anti-look-ahead', () => {
  it('ne remplit jamais sur la bougie de décision', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, ordres: [ordreMarcheDecideEn(T0)] };
    const resultat = traiterBougie(etat, contexte(bougie(T0, 1.08, 1.085, 1.075, 1.084)));

    expect(resultat.etat.positions).toHaveLength(0);
    expect(resultat.etat.ordres).toHaveLength(1);
    expect(resultat.evenements.filter((e) => e.type === 'ORDRE_REMPLI')).toHaveLength(0);
  });

  it('ne remplit pas non plus sur une bougie antérieure à la décision', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, ordres: [ordreMarcheDecideEn(T0)] };
    const resultat = traiterBougie(etat, contexte(bougie(T0 - PAS, 1.08, 1.085, 1.075, 1.084)));

    expect(resultat.etat.positions).toHaveLength(0);
    expect(resultat.etat.ordres).toHaveLength(1);
  });

  it('remplit sur la bougie suivante, à son ouverture', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, ordres: [ordreMarcheDecideEn(T0)] };
    const suivante = bougie(T0 + PAS, 1.0812, 1.0850, 1.0800, 1.0840);
    const resultat = traiterBougie(etat, contexte(suivante));

    expect(resultat.etat.positions).toHaveLength(1);
    // Ouverture 1.08120 + demi-spread (5 points × 0.00001 = 0.00005), sans
    // slippage dans la simulation parfaite.
    expect(resultat.etat.positions[0]!.prixEntree).toBeCloseTo(1.08125, 8);
  });

  /**
   * Le cas qui rend le biais si tentant : la clôture de la bougie de décision
   * était le meilleur prix de toute la séquence. Un moteur bogué s'en
   * servirait ; celui-ci ne peut pas y accéder.
   */
  it('n’utilise jamais un prix vu au moment de la décision', () => {
    const etat: EtatMoteur = { ...ETAT_NEUF, ordres: [ordreMarcheDecideEn(T0)] };

    // Bougie de décision : un plus bas très favorable à 1.0700.
    const apresDecision = traiterBougie(etat, contexte(bougie(T0, 1.08, 1.081, 1.07, 1.0805)));
    expect(apresDecision.etat.positions).toHaveLength(0);

    // Bougie suivante : le marché a sauté à 1.0900. C'est ce prix qu'on subit.
    const apresRemplissage = traiterBougie(
      apresDecision.etat,
      contexte(bougie(T0 + PAS, 1.09, 1.0915, 1.0895, 1.091)),
    );

    const position = apresRemplissage.etat.positions[0]!;
    expect(position.prixEntree).toBeGreaterThan(1.089);
    expect(position.prixEntree).not.toBeCloseTo(1.07, 3);
  });

  it('applique la même barrière aux ordres limite', () => {
    const ordre = creerOrdre({
      instrument: 'EURUSD',
      sens: 'ACHAT',
      type: 'LIMITE',
      quantite: 1,
      prixDemande: 1.075,
      stopLoss: 1.07,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    // La bougie de décision touche pourtant la limite.
    const etat: EtatMoteur = { ...ETAT_NEUF, ordres: [ordre] };
    const surDecision = traiterBougie(etat, contexte(bougie(T0, 1.08, 1.081, 1.074, 1.079)));
    expect(surDecision.etat.positions).toHaveLength(0);

    const suivante = traiterBougie(
      surDecision.etat,
      contexte(bougie(T0 + PAS, 1.079, 1.0795, 1.0745, 1.0785)),
    );
    expect(suivante.etat.positions).toHaveLength(1);
  });

  it('applique la même barrière aux ordres stop', () => {
    const ordre = creerOrdre({
      instrument: 'EURUSD',
      sens: 'ACHAT',
      type: 'STOP',
      quantite: 1,
      prixDemande: 1.0825,
      stopLoss: 1.078,
      takeProfit: null,
      horodatageDecision: T0,
      valideJusqua: null,
    });

    const etat: EtatMoteur = { ...ETAT_NEUF, ordres: [ordre] };
    const surDecision = traiterBougie(etat, contexte(bougie(T0, 1.08, 1.0840, 1.0795, 1.0835)));
    expect(surDecision.etat.positions).toHaveLength(0);

    const suivante = traiterBougie(
      surDecision.etat,
      contexte(bougie(T0 + PAS, 1.0835, 1.0860, 1.0830, 1.0855)),
    );
    expect(suivante.etat.positions).toHaveLength(1);
  });
});
