import { describe, expect, it } from 'vitest';

import { dureeSecondes } from '@/lib/marche/intervalles';
import { construireMarqueurs, type SourcesMarqueurs } from '@/lib/orchestration/marqueurs';

/**
 * Un marqueur mal aligné n'est pas affiché de travers : il n'est pas affiché
 * du tout. lightweight-charts ignore silencieusement un horodatage qui ne
 * correspond à aucune bougie, donc l'alignement est la propriété qui compte
 * le plus ici.
 */

// 2026-07-27 10:03:17 UTC — volontairement au milieu d'une bougie M5.
const DECISION = 1_785_146_597;
const OUVERTURE_M5 = Math.floor(DECISION / dureeSecondes('M5')) * dureeSecondes('M5');

function sources(surcharge: Partial<SourcesMarqueurs> = {}): SourcesMarqueurs {
  return { entrees: [], sorties: [], refus: [], ...surcharge };
}

const ENTREE = {
  id: 'p1',
  symbole: 'EURUSD',
  sens: 'ACHAT' as const,
  quantite: 0.5,
  prixEntree: 1.08,
  ouvertLe: DECISION,
  origine: 'AGENT' as const,
  raisonnement: 'Cassure de la résistance.',
};

describe('alignement sur la bougie', () => {
  it('ramène une décision de 10 h 03 à la bougie M5 de 10 h 00', () => {
    const [marqueur] = construireMarqueurs(sources({ entrees: [ENTREE] }), 'EURUSD', 'M5');
    expect(marqueur!.horodatage).toBe(OUVERTURE_M5);
    expect(marqueur!.horodatage % dureeSecondes('M5')).toBe(0);
  });

  it('réaligne quand l’intervalle change', () => {
    const enH1 = construireMarqueurs(sources({ entrees: [ENTREE] }), 'EURUSD', 'H1');
    expect(enH1[0]!.horodatage % dureeSecondes('H1')).toBe(0);
    expect(enH1[0]!.horodatage).toBeLessThanOrEqual(DECISION);
  });

  it('rend les marqueurs en ordre chronologique croissant', () => {
    const jeu = sources({
      entrees: [ENTREE, { ...ENTREE, id: 'p2', ouvertLe: DECISION - 3_600 }],
      sorties: [
        {
          id: 'p3',
          symbole: 'EURUSD',
          sens: 'ACHAT',
          prixSortie: 1.085,
          pnl: 250,
          motif: 'TAKE_PROFIT',
          fermeLe: DECISION - 7_200,
          origine: 'AGENT',
        },
      ],
    });

    const horodatages = construireMarqueurs(jeu, 'EURUSD', 'M5').map((m) => m.horodatage);
    expect([...horodatages].sort((a, b) => a - b)).toEqual(horodatages);
  });
});

describe('sens et forme', () => {
  it('pointe vers le haut sous la bougie pour un achat', () => {
    const [marqueur] = construireMarqueurs(sources({ entrees: [ENTREE] }), 'EURUSD', 'M5');
    expect(marqueur!.forme).toBe('arrowUp');
    expect(marqueur!.position).toBe('belowBar');
  });

  it('pointe vers le bas au-dessus de la bougie pour une vente', () => {
    const [marqueur] = construireMarqueurs(
      sources({ entrees: [{ ...ENTREE, sens: 'VENTE' }] }),
      'EURUSD',
      'M5',
    );
    expect(marqueur!.forme).toBe('arrowDown');
    expect(marqueur!.position).toBe('aboveBar');
  });

  it('place la sortie du côté opposé à l’entrée', () => {
    // Une position acheteuse se ferme par une vente : le marqueur ne doit pas
    // se superposer à celui de l'entrée.
    const [marqueur] = construireMarqueurs(
      sources({
        sorties: [
          {
            id: 's1',
            symbole: 'EURUSD',
            sens: 'ACHAT',
            prixSortie: 1.085,
            pnl: 250,
            motif: 'TAKE_PROFIT',
            fermeLe: DECISION,
            origine: 'AGENT',
          },
        ],
      }),
      'EURUSD',
      'M5',
    );
    expect(marqueur!.position).toBe('aboveBar');
  });
});

describe('affichage du résultat', () => {
  it('affiche une perte telle quelle, sans l’adoucir', () => {
    const [marqueur] = construireMarqueurs(
      sources({
        sorties: [
          {
            id: 's2',
            symbole: 'EURUSD',
            sens: 'ACHAT',
            prixSortie: 1.075,
            pnl: -320.5,
            motif: 'STOP_LOSS',
            fermeLe: DECISION,
            origine: 'AGENT',
          },
        ],
      }),
      'EURUSD',
      'M5',
    );

    expect(marqueur!.etiquette).toBe('-320.50');
    expect(marqueur!.couleur).toBe('#ef4444');
    expect(marqueur!.raisonnement).toMatch(/stop touché/);
  });

  it('dit « donnée manquante » plutôt que zéro quand le P&L est absent', () => {
    const [marqueur] = construireMarqueurs(
      sources({
        sorties: [
          {
            id: 's3',
            symbole: 'EURUSD',
            sens: 'VENTE',
            prixSortie: 1.07,
            pnl: null,
            motif: null,
            fermeLe: DECISION,
            origine: 'MANUEL',
          },
        ],
      }),
      'EURUSD',
      'M5',
    );

    expect(marqueur!.etiquette).toBe('Sortie');
    expect(marqueur!.raisonnement).toMatch(/donnée manquante/);
  });
});

describe('décisions non exécutées', () => {
  it('marque aussi ce que la firme a refusé de faire', () => {
    // Un garde-fou qui fait son travail est invisible : c'est précisément ce
    // qu'il faut rendre visible.
    const [marqueur] = construireMarqueurs(
      sources({
        refus: [
          {
            id: 'r1',
            symbole: 'EURUSD',
            sens: 'ACHAT',
            quantite: 2,
            horodatage: DECISION,
            statut: 'REJETEE_RISQUE',
            raison: 'Risque total dépassé.',
          },
        ],
      }),
      'EURUSD',
      'M5',
    );

    expect(marqueur!.forme).toBe('circle');
    expect(marqueur!.raisonnement).toMatch(/refusée par le moteur de risque/);
    expect(marqueur!.raisonnement).toMatch(/Risque total dépassé/);
  });
});

describe('filtrage par instrument', () => {
  it('n’affiche jamais la décision d’un autre symbole', () => {
    const jeu = sources({ entrees: [ENTREE, { ...ENTREE, id: 'p9', symbole: 'NAS100' }] });
    const marqueurs = construireMarqueurs(jeu, 'EURUSD', 'M5');

    expect(marqueurs).toHaveLength(1);
    expect(marqueurs[0]!.id).toBe('entree-p1');
  });

  it('rend une liste vide plutôt qu’une erreur sur un symbole sans décision', () => {
    expect(construireMarqueurs(sources({ entrees: [ENTREE] }), 'XAUUSD', 'M5')).toEqual([]);
  });
});
