import { describe, expect, it } from 'vitest';

import { domainesRefuses } from '@/lib/ia/anthropic';
import {
  DOMAINES_FONDAMENTAL,
  DOMAINES_INACCESSIBLES,
  DOMAINES_MACRO,
  DOMAINES_SENTIMENT,
} from '@/lib/orchestration/sources';

/**
 * Un seul domaine hors de portée fait échouer l'appel entier par un 400. Le
 * défaut est silencieux à la lecture du tableau de bord : le cycle rend quand
 * même une décision, simplement sans macro, sans fondamental et sans
 * sentiment. Ces tests tiennent les deux bouts — la liste ne doit plus
 * contenir de domaine mort, et un domaine qui meurt demain ne doit plus coûter
 * l'analyse.
 */

/** Message réel, recopié depuis un cycle du 28 juillet 2026. */
const MESSAGE_REEL =
  'Requête refusée par Anthropic : 400 {"type":"error","error":{"type":"invalid_request_error",' +
  '"message":"The following domains are not accessible to our user agent: ' +
  "['apnews.com', 'ft.com', 'marketwatch.com', 'reuters.com', 'wsj.com']. Read more: https://support.anthropic.com/en/a\"}}";

describe('domainesRefuses', () => {
  it('extrait les domaines du message réel qui a mis trois analystes en échec', () => {
    expect(domainesRefuses(new Error(MESSAGE_REEL))).toEqual([
      'apnews.com',
      'ft.com',
      'marketwatch.com',
      'reuters.com',
      'wsj.com',
    ]);
  });

  it('gère un domaine seul', () => {
    const erreur = new Error(
      "The following domains are not accessible to our user agent: ['ft.com']",
    );
    expect(domainesRefuses(erreur)).toEqual(['ft.com']);
  });

  it('accepte les guillemets doubles', () => {
    const erreur = new Error(
      'The following domains are not accessible to our user agent: ["ft.com", "wsj.com"]',
    );
    expect(domainesRefuses(erreur)).toEqual(['ft.com', 'wsj.com']);
  });

  it('rend une liste vide sur une autre erreur — l’originale doit remonter', () => {
    expect(domainesRefuses(new Error('Limite de débit atteinte.'))).toEqual([]);
    expect(domainesRefuses(new Error(''))).toEqual([]);
    expect(domainesRefuses(null)).toEqual([]);
  });

  it('rend une liste vide si la forme du message change', () => {
    const erreur = new Error('The following domains are not accessible to our user agent: aucun');
    expect(domainesRefuses(erreur)).toEqual([]);
  });
});

describe('listes de domaines', () => {
  const listes = {
    macro: DOMAINES_MACRO,
    fondamental: DOMAINES_FONDAMENTAL,
    sentiment: DOMAINES_SENTIMENT,
  };

  for (const [nom, liste] of Object.entries(listes)) {
    it(`la liste ${nom} ne contient aucun domaine constaté inaccessible`, () => {
      const morts = liste.filter((domaine) => DOMAINES_INACCESSIBLES.includes(domaine));
      expect(morts).toEqual([]);
    });

    it(`la liste ${nom} n’est pas vide — un analyste sans source ne sert à rien`, () => {
      expect(liste.length).toBeGreaterThan(0);
    });
  }
});
