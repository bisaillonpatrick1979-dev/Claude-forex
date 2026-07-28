import { describe, expect, it } from 'vitest';

import {
  analyserCsv,
  analyserJson,
  detecterSeparateur,
  formatDepuisNom,
  separateurDecimal,
  intervalleDeduit,
  lireDate,
  lireNombre,
  ordreJourMois,
} from '@/lib/marche/import-fichier';

/**
 * Un import qui se trompe ne produit pas une erreur visible : il produit un
 * historique **plausible et faux**. On backteste dessus, les agents raisonnent
 * dessus, et personne ne remet en cause son origine. Ces tests portent donc
 * surtout sur les refus — c'est là que se joue la valeur du module.
 */

describe('séparateur', () => {
  it('reconnaît la virgule, le point-virgule et la tabulation', () => {
    expect(detecterSeparateur('date,open,high,low,close')).toBe(',');
    expect(detecterSeparateur('date;open;high;low;close')).toBe(';');
    expect(detecterSeparateur('date\topen\thigh\tlow\tclose')).toBe('\t');
  });

  it('choisit le plus fréquent quand plusieurs sont présents', () => {
    // Un titre contenant une virgule ne doit pas faire élire la virgule.
    expect(detecterSeparateur('date;prix, en euros;open;high;low;close')).toBe(';');
  });
});

describe('séparateur décimal du fichier', () => {
  it('tranche sur une valeur qui porte les deux signes', () => {
    expect(separateurDecimal(['19,500.25'])).toBe('.');
    expect(separateurDecimal(['19.500,25'])).toBe(',');
  });

  it('tranche sur un groupe final qui n’a pas trois chiffres', () => {
    // Un groupe de milliers en a toujours trois : 1.0925 est donc décimal.
    expect(separateurDecimal(['1.0925'])).toBe('.');
    expect(separateurDecimal(['1,0925'])).toBe(',');
  });

  it('se rabat sur le seul signe présent', () => {
    // Un fichier de cotations qui grouperait les milliers aurait besoin de
    // l'autre signe pour ses décimales : son absence désigne le décimal.
    expect(separateurDecimal(['1,085', '1,090'])).toBe(',');
    expect(separateurDecimal(['1.085', '1.090'])).toBe('.');
  });

  it('rend null quand rien ne tranche', () => {
    expect(separateurDecimal(['1085', '1090'])).toBeNull();
    expect(separateurDecimal([])).toBeNull();
  });

  it('donne la priorité à la valeur décisive sur les autres', () => {
    // Une seule cotation à quatre décimales suffit pour tout le fichier.
    expect(separateurDecimal(['1,085', '1,0925', '1,090'])).toBe(',');
  });
});

describe('lecture des nombres', () => {
  it('applique le séparateur décidé pour le fichier', () => {
    expect(lireNombre('1.0925', '.')).toBeCloseTo(1.0925, 9);
    expect(lireNombre('1,0925', ',')).toBeCloseTo(1.0925, 9);
  });

  it('retire les séparateurs de milliers', () => {
    expect(lireNombre('1 234.56', '.')).toBeCloseTo(1234.56, 9);
    expect(lireNombre('1.234,56', ',')).toBeCloseTo(1234.56, 9);
    expect(lireNombre('19,500.25', '.')).toBeCloseTo(19500.25, 9);
  });

  it('lit « 1,234 » comme des milliers quand le point est le décimal', () => {
    expect(lireNombre('1,234', '.')).toBe(1234);
  });

  it('rend null sur du vide ou du texte', () => {
    expect(lireNombre('')).toBeNull();
    expect(lireNombre('   ')).toBeNull();
    expect(lireNombre('n/a')).toBeNull();
  });
});

describe('lecture des dates', () => {
  it('lit les formats sans ambiguïté', () => {
    expect(lireDate('2024-03-04', null).horodatage).toBe(Date.UTC(2024, 2, 4) / 1000);
    expect(lireDate('2024-03-04 14:30', null).horodatage).toBe(Date.UTC(2024, 2, 4, 14, 30) / 1000);
    expect(lireDate('2024-03-04T14:30:15Z', null).horodatage).toBe(
      Date.UTC(2024, 2, 4, 14, 30, 15) / 1000,
    );
    expect(lireDate('20240304', null).horodatage).toBe(Date.UTC(2024, 2, 4) / 1000);
  });

  it('lit un horodatage Unix, en secondes comme en millisecondes', () => {
    expect(lireDate('1709554800', null).horodatage).toBe(1709554800);
    expect(lireDate('1709554800000', null).horodatage).toBe(1709554800);
  });

  it('refuse une date ambiguë plutôt que de deviner', () => {
    // 03/04/2024 : 3 avril ou 4 mars ? Deviner décale tout un historique d'un
    // mois une fois sur deux, sans que rien ne le montre.
    const lecture = lireDate('03/04/2024', null);
    expect(lecture.horodatage).toBeNull();
    expect(lecture.refus).toMatch(/ambiguë/);
  });

  it('tranche seul quand une composante dépasse douze', () => {
    expect(lireDate('25/03/2024', null).horodatage).toBe(Date.UTC(2024, 2, 25) / 1000);
    expect(lireDate('03/25/2024', null).horodatage).toBe(Date.UTC(2024, 2, 25) / 1000);
  });

  it('applique l’ordre décidé pour le fichier', () => {
    expect(lireDate('03/04/2024', true).horodatage).toBe(Date.UTC(2024, 3, 3) / 1000);
    expect(lireDate('03/04/2024', false).horodatage).toBe(Date.UTC(2024, 2, 4) / 1000);
  });

  it('interprète toujours en UTC, jamais dans le fuseau de la machine', () => {
    // Une lecture en heure locale décalerait chaque bougie de plusieurs heures
    // selon l'endroit où tourne le serveur.
    expect(lireDate('2024-06-15 00:00:00', null).horodatage).toBe(Date.UTC(2024, 5, 15) / 1000);
  });

  it('refuse ce qui n’est pas une date', () => {
    expect(lireDate('', null).horodatage).toBeNull();
    expect(lireDate('bonjour', null).horodatage).toBeNull();
    expect(lireDate('2024-13-45', null).refus).toMatch(/invalide/);
  });
});

describe('ordre jour/mois sur le fichier', () => {
  it('tranche dès qu’une ligne lève l’ambiguïté', () => {
    expect(ordreJourMois(['01/02/2024', '25/02/2024'])).toBe(true);
    expect(ordreJourMois(['01/02/2024', '02/25/2024'])).toBe(false);
  });

  it('rend null quand aucune ligne ne tranche', () => {
    // Un fichier de janvier à décembre où le jour ne dépasse jamais douze est
    // authentiquement indéchiffrable. Le dire vaut mieux que le supposer.
    expect(ordreJourMois(['01/02/2024', '03/04/2024'])).toBeNull();
  });
});

describe('import CSV', () => {
  const entete = 'datetime,open,high,low,close,volume';

  it('lit un export ordinaire', () => {
    const resultat = analyserCsv(
      [
        entete,
        '2024-03-04 00:00:00,1.0850,1.0900,1.0840,1.0880,1200',
        '2024-03-05 00:00:00,1.0880,1.0920,1.0870,1.0910,1350',
      ].join('\n'),
    );

    expect(resultat.bloquant).toBe(false);
    expect(resultat.chandeliers).toHaveLength(2);
    expect(resultat.chandeliers[0]!.ouverture).toBeCloseTo(1.085, 9);
    expect(resultat.chandeliers[0]!.volume).toBe(1200);
  });

  it('remet les bougies dans l’ordre chronologique', () => {
    // Beaucoup d'exports vont du plus récent au plus ancien, et le moteur de
    // backtest suppose l'ordre inverse.
    const resultat = analyserCsv(
      [
        entete,
        '2024-03-05 00:00:00,1.0880,1.0920,1.0870,1.0910,1',
        '2024-03-04 00:00:00,1.0850,1.0900,1.0840,1.0880,1',
      ].join('\n'),
    );

    expect(resultat.chandeliers[0]!.horodatage).toBeLessThan(resultat.chandeliers[1]!.horodatage);
  });

  it('reconnaît les en-têtes MetaTrader', () => {
    const resultat = analyserCsv(
      [
        '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>',
        '2024.03.04\t00:00:00\t1.0850\t1.0900\t1.0840\t1.0880\t120',
      ].join('\n'),
    );

    expect(resultat.bloquant).toBe(false);
    expect(resultat.chandeliers).toHaveLength(1);
    expect(resultat.chandeliers[0]!.horodatage).toBe(Date.UTC(2024, 2, 4) / 1000);
  });

  it('combine une colonne date et une colonne heure séparées', () => {
    const resultat = analyserCsv(
      ['date,time,open,high,low,close', '2024-03-04,14:30,1.0850,1.0900,1.0840,1.0880'].join('\n'),
    );
    expect(resultat.chandeliers[0]!.horodatage).toBe(Date.UTC(2024, 2, 4, 14, 30) / 1000);
  });

  it('rejette une bougie incohérente sans corriger en silence', () => {
    // Haut sous le bas : haut et bas sont inversés à l'export. Réparer
    // masquerait la faute et laisserait passer les vraies inversions.
    const resultat = analyserCsv(
      [entete, '2024-03-04 00:00:00,1.0850,1.0800,1.0900,1.0880,1'].join('\n'),
    );

    expect(resultat.chandeliers).toHaveLength(0);
    expect(resultat.anomalies.some((a) => /inversées/.test(a.message))).toBe(true);
  });

  it('rejette un haut qui ne couvre pas la clôture', () => {
    const resultat = analyserCsv(
      [entete, '2024-03-04 00:00:00,1.0850,1.0860,1.0840,1.0880,1'].join('\n'),
    );
    expect(resultat.anomalies.some((a) => /haut/.test(a.message))).toBe(true);
  });

  it('rejette un prix nul ou négatif', () => {
    const resultat = analyserCsv([entete, '2024-03-04 00:00:00,0,0,0,0,1'].join('\n'));
    expect(resultat.anomalies.some((a) => /nul ou négatif/.test(a.message))).toBe(true);
  });

  it('écarte les doublons d’horodatage', () => {
    // Un fichier concaténé deux fois ne doit pas doubler le volume.
    const ligne = '2024-03-04 00:00:00,1.0850,1.0900,1.0840,1.0880,1';
    const resultat = analyserCsv([entete, ligne, ligne].join('\n'));

    expect(resultat.chandeliers).toHaveLength(1);
    expect(resultat.anomalies.some((a) => /doublon/.test(a.message))).toBe(true);
  });

  it('bloque quand plus de la moitié des lignes est rejetée', () => {
    // Ce n'est plus un fichier imparfait, c'est un fichier mal interprété.
    const resultat = analyserCsv(
      [
        entete,
        '2024-03-04 00:00:00,1.0850,1.0900,1.0840,1.0880,1',
        'nawak,x,y,z,w,v',
        'encore,x,y,z,w,v',
      ].join('\n'),
    );

    expect(resultat.bloquant).toBe(true);
    expect(resultat.anomalies.some((a) => /mal interprété/.test(a.message))).toBe(true);
  });

  it('nomme les colonnes manquantes plutôt que d’échouer vaguement', () => {
    const resultat = analyserCsv(['date,open,close', '2024-03-04,1.08,1.09'].join('\n'));

    expect(resultat.bloquant).toBe(true);
    expect(resultat.anomalies[0]!.message).toMatch(/haut/);
    expect(resultat.anomalies[0]!.message).toMatch(/bas/);
    // Les en-têtes réellement lus sont rappelés : sans eux, l'utilisateur ne
    // sait pas quoi corriger.
    expect(resultat.anomalies[0]!.message).toMatch(/En-têtes lus/);
  });

  it('publie les colonnes reconnues pour que l’interprétation soit vérifiable', () => {
    const resultat = analyserCsv([entete, '2024-03-04,1.08,1.09,1.07,1.085,1'].join('\n'));
    expect(resultat.colonnes.ouverture).toBe('open');
    expect(resultat.colonnes.cloture).toBe('close');
  });

  it('signale l’hypothèse quand le séparateur décimal reste indécidable', () => {
    // Aucune valeur ne tranche : l'import passe, mais la supposition est dite.
    const resultat = analyserCsv(
      ['date,open,high,low,close', '2024-03-04,1085,1090,1084,1088'].join('\n'),
    );
    expect(resultat.bloquant).toBe(false);
    expect(resultat.anomalies.some((a) => /indéterminable/.test(a.message))).toBe(true);
  });

  it('respecte les guillemets', () => {
    const resultat = analyserCsv(
      ['"date","open","high","low","close"', '"2024-03-04","1,085","1,090","1,084","1,088"'].join(
        '\n',
      ),
    );
    expect(resultat.chandeliers).toHaveLength(1);
    expect(resultat.chandeliers[0]!.ouverture).toBeCloseTo(1.085, 9);
  });

  it('refuse un fichier sans ligne de données', () => {
    expect(analyserCsv(entete).bloquant).toBe(true);
    expect(analyserCsv('').bloquant).toBe(true);
  });

  it('garde « close » plutôt que « adj close »', () => {
    const resultat = analyserCsv(
      [
        'Date,Open,High,Low,Close,Adj Close,Volume',
        '2024-03-04,1.0850,1.0900,1.0840,1.0880,1.0870,1',
      ].join('\n'),
    );
    expect(resultat.chandeliers[0]!.cloture).toBeCloseTo(1.088, 9);
  });
});

describe('import JSON', () => {
  it('lit un tableau de bougies', () => {
    const resultat = analyserJson(
      JSON.stringify([
        { datetime: '2024-03-04', open: 1.085, high: 1.09, low: 1.084, close: 1.088, volume: 10 },
      ]),
    );
    expect(resultat.chandeliers).toHaveLength(1);
    expect(resultat.chandeliers[0]!.volume).toBe(10);
  });

  it('lit l’enveloppe { values } de Twelve Data', () => {
    const resultat = analyserJson(
      JSON.stringify({
        meta: { symbol: 'EUR/USD' },
        values: [
          { datetime: '2024-03-04', open: '1.0850', high: '1.0900', low: '1.0840', close: '1.0880' },
        ],
      }),
    );
    expect(resultat.bloquant).toBe(false);
    expect(resultat.chandeliers[0]!.ouverture).toBeCloseTo(1.085, 9);
  });

  it('accepte les nombres comme les chaînes', () => {
    const resultat = analyserJson(
      JSON.stringify([{ date: '2024-03-04', open: 1.085, high: '1.09', low: 1.084, close: '1.088' }]),
    );
    expect(resultat.chandeliers).toHaveLength(1);
  });

  it('refuse un JSON illisible ou de forme inattendue', () => {
    expect(analyserJson('{pas du json').bloquant).toBe(true);
    expect(analyserJson('{"rien": 1}').bloquant).toBe(true);
    expect(analyserJson('[]').bloquant).toBe(true);
  });
});

describe('format déduit du nom', () => {
  it('suit l’extension quand elle est explicite', () => {
    expect(formatDepuisNom('eurusd.json', '')).toBe('json');
    expect(formatDepuisNom('eurusd.csv', '')).toBe('csv');
    expect(formatDepuisNom('eurusd.txt', '')).toBe('csv');
  });

  it('se rabat sur le contenu quand l’extension ne dit rien', () => {
    expect(formatDepuisNom('donnees', '[{"open":1}]')).toBe('json');
    expect(formatDepuisNom('donnees', 'date,open')).toBe('csv');
  });
});

describe('intervalle déduit', () => {
  const serie = (pas: number, nombre: number) =>
    Array.from({ length: nombre }, (_, index) => ({
      horodatage: 1_700_000_000 + index * pas,
      ouverture: 1,
      haut: 1,
      bas: 1,
      cloture: 1,
      volume: null,
    }));

  it('reconnaît l’espacement régulier', () => {
    expect(intervalleDeduit(serie(300, 10))).toBe(300);
    expect(intervalleDeduit(serie(86_400, 10))).toBe(86_400);
  });

  it('résiste aux trous de fin de semaine', () => {
    // La médiane ignore les week-ends ; une moyenne ferait passer du
    // journalier pour du bi-quotidien.
    const avecTrous = [
      ...serie(86_400, 5),
      { horodatage: 1_700_000_000 + 5 * 86_400 + 3 * 86_400, ouverture: 1, haut: 1, bas: 1, cloture: 1, volume: null },
    ];
    expect(intervalleDeduit(avecTrous)).toBe(86_400);
  });

  it('rend null sur une série trop courte', () => {
    expect(intervalleDeduit(serie(300, 2))).toBeNull();
  });
});
