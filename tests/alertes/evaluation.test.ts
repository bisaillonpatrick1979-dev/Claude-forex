import { describe, expect, it } from 'vitest';

import {
  blocEvenements,
  determinerCote,
  surveiller,
  zoneMorteSuggeree,
  type Alerte,
} from '@/lib/alertes/evaluation';

/**
 * Une alerte se trompe de deux façons, graves dans des sens opposés : sonner
 * quand rien ne s'est passé — on cesse d'y croire — ou rester muette au moment
 * exact où le niveau cède. La zone morte règle la première, la machine à états
 * la seconde. Ces tests couvrent les deux, ainsi que le piège qui les relie :
 * un état mis à jour trop sélectivement se désynchronise et rend l'alerte
 * définitivement sourde.
 */

function alerte(surcharge: Partial<Alerte> = {}): Alerte {
  return {
    id: 'a1',
    symbole: 'EURUSD',
    niveau: 1.09,
    zoneMorte: 0.0001,
    direction: 'les_deux',
    derniereCote: 'dessous',
    usageUnique: false,
    libelleAnnotation: null,
    ...surcharge,
  };
}

const prix = (valeur: number) => new Map([['EURUSD', valeur]]);

describe('détermination du côté', () => {
  it('classe au-dessus, au-dessous et dans la zone morte', () => {
    expect(determinerCote(1.0902, 1.09, 0.0001)).toBe('dessus');
    expect(determinerCote(1.0898, 1.09, 0.0001)).toBe('dessous');
    expect(determinerCote(1.09005, 1.09, 0.0001)).toBe('dedans');
  });

  it('place les bornes exactes dans la zone morte', () => {
    // Le niveau ± la zone morte appartient à la bande neutre : sinon le cours
    // basculerait de côté en s'arrêtant pile sur la limite.
    expect(determinerCote(1.0901, 1.09, 0.0001)).toBe('dedans');
    expect(determinerCote(1.0899, 1.09, 0.0001)).toBe('dedans');
  });

  it('tolère une zone morte négative', () => {
    // Une valeur saisie à l'envers ne doit pas inverser la logique.
    expect(determinerCote(1.0902, 1.09, -0.0001)).toBe('dessus');
  });

  it('se comporte comme une comparaison stricte sans zone morte', () => {
    expect(determinerCote(1.09, 1.09, 0)).toBe('dedans');
    expect(determinerCote(1.0900001, 1.09, 0)).toBe('dessus');
  });
});

describe('franchissement', () => {
  it('déclenche sur dessous → dessus', () => {
    const resultat = surveiller([alerte()], prix(1.0902));
    expect(resultat.franchissements).toHaveLength(1);
    expect(resultat.franchissements[0]!.sens).toBe('haussier');
  });

  it('déclenche sur dessus → dessous', () => {
    const resultat = surveiller([alerte({ derniereCote: 'dessus' })], prix(1.0898));
    expect(resultat.franchissements[0]!.sens).toBe('baissier');
  });

  it('ne déclenche pas en entrant dans la zone morte', () => {
    // C'est tout l'intérêt du troisième état : approcher n'est pas franchir.
    const resultat = surveiller([alerte()], prix(1.09));
    expect(resultat.franchissements).toHaveLength(0);
    expect(resultat.misesAJour[0]!.cote).toBe('dedans');
  });

  it('ne déclenche pas en ressortant du même côté', () => {
    // dessous → dedans → dessous : le cours a testé le niveau sans le passer.
    const dedans = surveiller([alerte()], prix(1.09));
    expect(dedans.franchissements).toHaveLength(0);

    const retour = surveiller([alerte({ derniereCote: 'dedans' })], prix(1.0898));
    expect(retour.franchissements).toHaveLength(0);
  });

  it('ne déclenche jamais au premier passage', () => {
    // Sans côté connu, il n'y a pas de trajet : armer une alerte au-dessus du
    // cours ne doit pas la faire sonner immédiatement.
    const resultat = surveiller([alerte({ derniereCote: null })], prix(1.0902));
    expect(resultat.franchissements).toHaveLength(0);
    expect(resultat.misesAJour[0]!.cote).toBe('dessus');
  });

  it('reconnaît un franchissement direct, sans passage observé par la zone', () => {
    // Entre deux tours le cours a traversé toute la bande : le franchissement
    // reste vrai même si aucune observation n'est tombée « dedans ».
    const resultat = surveiller([alerte()], prix(1.12));
    expect(resultat.franchissements).toHaveLength(1);
  });
});

describe('direction surveillée', () => {
  it('ignore une descente sur une alerte haussière', () => {
    const resultat = surveiller(
      [alerte({ direction: 'haussier', derniereCote: 'dessus' })],
      prix(1.0898),
    );
    expect(resultat.franchissements).toHaveLength(0);
  });

  it('suit quand même l’état sur une direction ignorée', () => {
    // Le piège : filtrer la mise à jour comme le déclenchement désynchronise la
    // machine. L'alerte haussière resterait bloquée sur « dessus » et ne
    // pourrait plus jamais voir la remontée suivante.
    const resultat = surveiller(
      [alerte({ direction: 'haussier', derniereCote: 'dessus' })],
      prix(1.0898),
    );
    expect(resultat.misesAJour).toEqual([
      { id: 'a1', cote: 'dessous', prix: 1.0898, desactiver: false },
    ]);
  });

  it('déclenche ensuite la remontée, l’état ayant suivi', () => {
    const resultat = surveiller(
      [alerte({ direction: 'haussier', derniereCote: 'dessous' })],
      prix(1.0902),
    );
    expect(resultat.franchissements).toHaveLength(1);
  });
});

describe('usage unique', () => {
  it('demande la désactivation après déclenchement', () => {
    const resultat = surveiller([alerte({ usageUnique: true })], prix(1.0902));
    expect(resultat.misesAJour[0]!.desactiver).toBe(true);
  });

  it('ne désactive pas sur un simple changement d’état', () => {
    const resultat = surveiller([alerte({ usageUnique: true })], prix(1.09));
    expect(resultat.misesAJour[0]!.desactiver).toBe(false);
  });

  it('ne désactive pas quand la direction ne correspond pas', () => {
    const resultat = surveiller(
      [alerte({ usageUnique: true, direction: 'haussier', derniereCote: 'dessus' })],
      prix(1.0898),
    );
    expect(resultat.misesAJour[0]!.desactiver).toBe(false);
  });
});

describe('symbole indisponible', () => {
  it('ne touche pas à l’état quand le prix manque', () => {
    // Écrire un côté à partir d'un prix qu'on n'a pas obtenu inventerait un
    // mouvement, et pourrait faire manquer le vrai franchissement suivant.
    const resultat = surveiller([alerte()], new Map());
    expect(resultat.franchissements).toHaveLength(0);
    expect(resultat.misesAJour).toHaveLength(0);
  });

  it('ignore un prix non fini', () => {
    const resultat = surveiller([alerte()], prix(Number.NaN));
    expect(resultat.misesAJour).toHaveLength(0);
  });
});

describe('message', () => {
  it('nomme le tracé quand il en a un', () => {
    const resultat = surveiller(
      [alerte({ libelleAnnotation: 'Résistance hebdo' })],
      prix(1.0902),
    );
    expect(resultat.franchissements[0]!.message).toContain('Résistance hebdo');
    expect(resultat.franchissements[0]!.message).toContain('à la hausse');
  });

  it('se rabat sur le niveau quand le tracé est anonyme', () => {
    const message = surveiller([alerte()], prix(1.0902)).franchissements[0]!.message;
    expect(message).toContain('1.09000');
  });
});

describe('zone morte suggérée', () => {
  it('est proportionnelle au prix', () => {
    // Deux points sur EUR/USD et deux points sur NAS100 ne sont pas la même
    // chose : une valeur fixe conviendrait à l'un et pas à l'autre.
    expect(zoneMorteSuggeree(1.09)).toBeCloseTo(0.0000545, 9);
    expect(zoneMorteSuggeree(19_500)).toBeCloseTo(0.975, 6);
  });

  it('reste positive sur un niveau négatif', () => {
    expect(zoneMorteSuggeree(-50)).toBeGreaterThan(0);
  });
});

describe('bloc remis aux agents', () => {
  const evenement = {
    symbole: 'EURUSD',
    niveau: 1.09,
    prix: 1.0902,
    direction: 'haussier',
    libelleAnnotation: 'Résistance hebdo',
    declencheLe: '2026-07-27 09:20',
  };

  it('est vide sans événement', () => {
    expect(blocEvenements([], 5)).toBe('');
  });

  it('présente le franchissement comme un fait, pas comme un signal', () => {
    // Un agent qui lirait « niveau franchi » comme un ordre d'achat déguisé
    // ferait exactement l'erreur que cette formulation cherche à éviter.
    const texte = blocEvenements([evenement], 5);
    expect(texte).toContain('faits datés');
    expect(texte).toContain('pas des signaux');
    expect(texte).toContain('invalider une hypothèse');
  });

  it('cite le tracé, le prix et l’heure', () => {
    const texte = blocEvenements([evenement], 5);
    expect(texte).toContain('Résistance hebdo');
    expect(texte).toContain('1.09020');
    expect(texte).toContain('2026-07-27 09:20');
  });
});
