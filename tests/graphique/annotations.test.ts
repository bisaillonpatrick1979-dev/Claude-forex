import { describe, expect, it } from 'vitest';

import {
  annotationVisible,
  bloc,
  decrireAnnotation,
  niveauxAnnotation,
  POINTS_REQUIS,
  prixTendance,
  type Annotation,
} from '@/lib/graphique/annotations';

/**
 * Ce qui distingue ces annotations de celles d'une plateforme commerciale :
 * elles doivent être **lisibles par un modèle**. Un trait qu'on ne sait pas
 * mettre en mots ne sert à rien ici, quelle que soit son allure à l'écran.
 * Ces tests portent donc autant sur la géométrie que sur la phrase produite.
 */

function annotation(surcharge: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    symbole: 'EURUSD',
    intervalle: null,
    outil: 'NIVEAU',
    points: [{ horodatage: 1_785_000_000, prix: 1.092 }],
    couleur: '#4c9aff',
    libelle: null,
    ...surcharge,
  };
}

describe('visibilité', () => {
  it('n’affiche pas l’annotation d’un autre instrument', () => {
    expect(annotationVisible(annotation({}), 'GBPUSD', 'M5')).toBe(false);
  });

  it('affiche une annotation sans intervalle sur toutes les unités de temps', () => {
    // Une résistance journalière ne disparaît pas parce qu'on passe en M5.
    expect(annotationVisible(annotation({}), 'EURUSD', 'M5')).toBe(true);
    expect(annotationVisible(annotation({}), 'EURUSD', 'D1')).toBe(true);
  });

  it('restreint une annotation liée à un intervalle', () => {
    const liee = annotation({ intervalle: 'H1' });
    expect(annotationVisible(liee, 'EURUSD', 'H1')).toBe(true);
    expect(annotationVisible(liee, 'EURUSD', 'M5')).toBe(false);
  });
});

describe('niveaux portés', () => {
  it('donne un seul prix pour un niveau horizontal', () => {
    expect(niveauxAnnotation(annotation({})).map((n) => n.prix)).toEqual([1.092]);
  });

  it('donne les sept niveaux d’un retracement', () => {
    const fibo = annotation({
      outil: 'FIBONACCI',
      points: [
        { horodatage: 1, prix: 1.08 },
        { horodatage: 2, prix: 1.1 },
      ],
    });
    const niveaux = niveauxAnnotation(fibo);
    expect(niveaux).toHaveLength(7);
    expect(niveaux.find((n) => n.ratio === 0.618)!.prix).toBeCloseTo(1.08764, 6);
  });

  it('donne les deux bords d’une zone, dans l’ordre bas puis haut', () => {
    // L'utilisateur peut tracer du haut vers le bas : les bords doivent
    // sortir triés, sinon « le prix est à l'intérieur » devient faux.
    const zone = annotation({
      outil: 'ZONE',
      points: [
        { horodatage: 1, prix: 1.1 },
        { horodatage: 2, prix: 1.09 },
      ],
    });
    expect(niveauxAnnotation(zone).map((n) => n.prix)).toEqual([1.09, 1.1]);
  });

  it('ne donne aucun niveau fixe pour une tendance', () => {
    // Son prix dépend de l'instant : publier un prix figé serait mentir.
    const tendance = annotation({
      outil: 'TENDANCE',
      points: [
        { horodatage: 1, prix: 1.08 },
        { horodatage: 2, prix: 1.09 },
      ],
    });
    expect(niveauxAnnotation(tendance)).toHaveLength(0);
  });

  it('supporte une annotation incomplète sans lever', () => {
    // L'outil est en cours de tracé : un point posé, le second en attente.
    const partielle = annotation({ outil: 'FIBONACCI', points: [{ horodatage: 1, prix: 1.08 }] });
    expect(niveauxAnnotation(partielle)).toHaveLength(0);
  });
});

describe('ligne de tendance', () => {
  const tendance = annotation({
    outil: 'TENDANCE',
    points: [
      { horodatage: 1000, prix: 1.08 },
      { horodatage: 2000, prix: 1.09 },
    ],
  });

  it('interpole entre les deux points', () => {
    expect(prixTendance(tendance, 1500)).toBeCloseTo(1.085, 9);
  });

  it('se prolonge au-delà du second point', () => {
    // Sans prolongement, il faudrait redessiner la droite à chaque bougie.
    expect(prixTendance(tendance, 3000)).toBeCloseTo(1.1, 9);
    expect(prixTendance(tendance, 0)).toBeCloseTo(1.07, 9);
  });

  it('rend null sur une droite verticale', () => {
    const verticale = annotation({
      outil: 'TENDANCE',
      points: [
        { horodatage: 1000, prix: 1.08 },
        { horodatage: 1000, prix: 1.09 },
      ],
    });
    expect(prixTendance(verticale, 1000)).toBeNull();
  });

  it('rend null pour un outil qui n’est pas une tendance', () => {
    expect(prixTendance(annotation({}), 1500)).toBeNull();
  });
});

describe('mise en mots', () => {
  it('situe le marché par rapport à un niveau plutôt que de le citer', () => {
    const sous = decrireAnnotation(annotation({}), 1.085, 5).texte;
    expect(sous).toContain('1.09200');
    expect(sous).toContain('au-dessous');
    expect(sous).toContain('résistance');

    const dessus = decrireAnnotation(annotation({}), 1.095, 5).texte;
    expect(dessus).toContain('au-dessus');
    expect(dessus).toContain('support');
  });

  it('reprend le nom donné par le trader', () => {
    const texte = decrireAnnotation(annotation({ libelle: 'Sommet de mars' }), 1.085, 5).texte;
    expect(texte).toContain('Sommet de mars');
  });

  it('énumère les niveaux d’un Fibonacci et désigne le plus proche', () => {
    const fibo = annotation({
      outil: 'FIBONACCI',
      points: [
        { horodatage: 1, prix: 1.08 },
        { horodatage: 2, prix: 1.1 },
      ],
    });
    const texte = decrireAnnotation(fibo, 1.0877, 5).texte;
    expect(texte).toContain('61,8 %');
    expect(texte).toContain('plus proche du 61,8 %');
    expect(texte).toContain('pratiquement dessus');
  });

  it('ne prétend pas que le prix est sur un niveau quand il flotte entre deux', () => {
    // 1.09118 est à mi-chemin du 38,2 % (1.09236) et du 50 % (1.09000) :
    // c'est la position la plus éloignée possible de tout niveau.
    const fibo = annotation({
      outil: 'FIBONACCI',
      points: [
        { horodatage: 1, prix: 1.08 },
        { horodatage: 2, prix: 1.1 },
      ],
    });
    const texte = decrireAnnotation(fibo, 1.09118, 5).texte;
    expect(texte).toContain('plus proche du');
    expect(texte).not.toContain('pratiquement dessus');
  });

  it('applique le seuil « sur le niveau » en proportion de l’amplitude', () => {
    // Le même écart en prix se juge différemment selon l'ampleur du tracé :
    // deux points sur un mouvement de 20 pips, ce n'est pas deux points sur
    // un mouvement de 400.
    const points = (bas: number, haut: number) => [
      { horodatage: 1, prix: bas },
      { horodatage: 2, prix: haut },
    ];

    const etroit = annotation({ outil: 'FIBONACCI', points: points(1.09, 1.092) });
    const large = annotation({ outil: 'FIBONACCI', points: points(1.05, 1.13) });

    // 1.09124 est à 0,00012 du 61,8 % du tracé étroit (1.09124 exactement).
    const surLeNiveau = 1.09 + 0.002 * 0.382 + 0.000015;
    expect(decrireAnnotation(etroit, surLeNiveau, 5).texte).toContain('pratiquement dessus');
    // Le même écart absolu sur le tracé large est quatre fois plus petit en
    // relatif : il reste « dessus » lui aussi.
    const surLeNiveauLarge = 1.05 + 0.08 * 0.382 + 0.0000015;
    expect(decrireAnnotation(large, surLeNiveauLarge, 5).texte).toContain('pratiquement dessus');
  });

  it('dit si le prix est dans la zone', () => {
    const zone = annotation({
      outil: 'ZONE',
      points: [
        { horodatage: 1, prix: 1.09 },
        { horodatage: 2, prix: 1.1 },
      ],
    });
    expect(decrireAnnotation(zone, 1.095, 5).texte).toContain('à l’intérieur');
    expect(decrireAnnotation(zone, 1.101, 5).texte).toContain('au-dessus');
  });

  it('avertit qu’une tendance n’a pas de prix figé', () => {
    const tendance = annotation({
      outil: 'TENDANCE',
      points: [
        { horodatage: 1, prix: 1.08 },
        { horodatage: 2, prix: 1.09 },
      ],
    });
    const texte = decrireAnnotation(tendance, 1.085, 5).texte;
    expect(texte).toContain('haussière');
    expect(texte).toContain('évolue avec le temps');
  });

  it('décrit un tracé incomplet sans lever', () => {
    const partielle = annotation({ outil: 'ZONE', points: [{ horodatage: 1, prix: 1.08 }] });
    expect(decrireAnnotation(partielle, 1.09, 5).texte).toContain('incomplète');
  });
});

describe('bloc remis aux agents', () => {
  it('est vide quand rien n’est tracé', () => {
    expect(bloc([], 1.09, 5)).toBe('');
  });

  it('présente les repères comme des hypothèses, pas comme des mesures', () => {
    // Sans cette précaution, un agent traiterait un trait posé à la main avec
    // la même confiance qu'un prix de marché.
    const texte = bloc([annotation({})], 1.085, 5);
    expect(texte).toContain('hypothèses humaines');
    expect(texte).toContain('pas des mesures');
    // Et il doit être autorisé à être en désaccord.
    expect(texte).toMatch(/contredire/);
  });

  it('liste une ligne par annotation', () => {
    const texte = bloc([annotation({}), annotation({ id: 'a2' })], 1.085, 5);
    expect(texte.split('\n').filter((ligne) => ligne.startsWith('- '))).toHaveLength(2);
  });
});

describe('contrat des outils', () => {
  it('déclare un nombre de points pour chaque outil', () => {
    for (const [outil, points] of Object.entries(POINTS_REQUIS)) {
      expect([1, 2]).toContain(points);
      expect(outil.length).toBeGreaterThan(0);
    }
  });
});
