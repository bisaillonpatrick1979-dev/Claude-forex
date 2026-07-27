import { describe, expect, it } from 'vitest';

import { adaptateur, FOURNISSEURS_LLM } from '@/lib/ia';
import {
  accepteTemperature,
  coutUsd,
  MODELES_PAR_FOURNISSEUR,
  tarif,
} from '@/lib/ia/tarifs';
import { adaptateurMock } from '@/lib/ia/mock';
import {
  analyser,
  extraireJson,
  schemaProposition,
  schemaVueMarche,
  verifierAncrage,
} from '@/lib/orchestration/extraction';
import type { InstantaneMarche } from '@/lib/orchestration/instantane';
import {
  CONSIGNE_RECHERCHE,
  domainesPour,
  rechercheAutorisee,
} from '@/lib/orchestration/sources';

/**
 * Un modèle rend du texte, pas un objet. Ces tests fixent le comportement
 * attendu quand ce texte est mal formé — et surtout quand il contient un prix
 * qui n'existe nulle part dans l'instantané.
 */

const INSTANTANE: InstantaneMarche = {
  symbole: 'EURUSD',
  classeActif: 'FOREX',
  intervalle: 'M5',
  decimales: 5,
  deviseCotation: 'USD',
  chandeliers: [],
  dernierPrix: 1.08,
  plusHaut: 1.085,
  plusBas: 1.075,
  indicateurs: {
    rsi14: 55,
    atr14: 0.001,
    ema20: 1.079,
    ema50: 1.078,
    ema200: null,
    macd: null,
    macdSignal: null,
    macdHistogramme: null,
  },
  origine: 'FOURNISSEUR',
  fournisseur: 'mock',
  perime: false,
  retarde: false,
  constitueLe: 1_785_000_000,
  nombreBougiesTotal: 300,
};

describe('extraction du JSON', () => {
  it('prend le dernier bloc : les modèles illustrent puis concluent', () => {
    const texte = [
      'Exemple :',
      '```json',
      '{"direction":"NEUTRE","conviction":10,"resume":"exemple"}',
      '```',
      'Ma vraie réponse :',
      '```json',
      '{"direction":"HAUSSIER","conviction":70,"resume":"réel"}',
      '```',
    ].join('\n');

    const valeur = extraireJson(texte) as { resume: string };
    expect(valeur.resume).toBe('réel');
  });

  it('retombe sur les accolades quand le bloc n’est pas fermé', () => {
    const valeur = extraireJson('Voici : {"direction":"BAISSIER","conviction":40,"resume":"x"}');
    expect(valeur).toMatchObject({ direction: 'BAISSIER' });
  });

  it('rend null plutôt que de deviner sur du texte sans JSON', () => {
    expect(extraireJson('Je pense que le marché va monter.')).toBeNull();
  });

  it('nomme le champ fautif au lieu d’un « invalide » générique', () => {
    const resultat = analyser(
      schemaVueMarche,
      '```json\n{"direction":"LATERAL","conviction":50,"resume":"x"}\n```',
    );
    expect(resultat.ok).toBe(false);
    expect(resultat.erreur).toMatch(/direction/);
  });

  it('refuse une proposition d’ordre sans stop-loss', () => {
    const resultat = analyser(
      schemaProposition,
      '```json\n{"action":"ORDRE","sens":"ACHAT","type_ordre":"MARCHE","quantite":1,"raisonnement":"go"}\n```',
    );
    expect(resultat.ok).toBe(false);
  });

  it('accepte une abstention : ne rien faire est une réponse valide', () => {
    const resultat = analyser(
      schemaProposition,
      '```json\n{"action":"ABSTENTION","raisonnement":"conditions hostiles"}\n```',
    );
    expect(resultat.ok).toBe(true);
  });
});

describe('ancrage des niveaux', () => {
  const base = {
    action: 'ORDRE' as const,
    sens: 'ACHAT' as const,
    type_ordre: 'MARCHE' as const,
    quantite: 1,
    prix_entree: 1.08,
    stop_loss: 1.077,
    take_profit: 1.084,
    raisonnement: 'test',
  };

  it('laisse passer des niveaux cohérents avec l’instantané', () => {
    expect(verifierAncrage(base, INSTANTANE).ok).toBe(true);
  });

  it('refuse un prix qui n’a aucun rapport avec l’instantané', () => {
    const verdict = verifierAncrage({ ...base, take_profit: 1.5 }, INSTANTANE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.raison).toMatch(/hors instantané/i);
  });

  it('refuse un stop du mauvais côté de l’entrée', () => {
    const verdict = verifierAncrage({ ...base, stop_loss: 1.082 }, INSTANTANE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.raison).toMatch(/stop-loss incohérent/i);
  });

  it('refuse une cible du mauvais côté de l’entrée', () => {
    const verdict = verifierAncrage({ ...base, take_profit: 1.078 }, INSTANTANE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.raison).toMatch(/take-profit incohérent/i);
  });

  it('tolère un stop hors du range récent : c’est un choix de trading légitime', () => {
    // 1.0745 est sous le plus bas de l'instantané, mais dans la marge admise.
    expect(verifierAncrage({ ...base, stop_loss: 1.0745 }, INSTANTANE).ok).toBe(true);
  });
});

describe('tarifs et contraintes de modèle', () => {
  it('ne transmet pas de température aux modèles Anthropic qui la refusent', () => {
    // Opus 5 et Sonnet 5 répondent 400 quand le champ est présent : ce n'est
    // pas un avertissement, l'appel échoue.
    expect(accepteTemperature('anthropic', 'claude-opus-5')).toBe(false);
    expect(accepteTemperature('anthropic', 'claude-sonnet-5')).toBe(false);
    expect(accepteTemperature('anthropic', 'claude-haiku-4-5')).toBe(true);
    expect(accepteTemperature('openai', 'gpt-5.1')).toBe(true);
  });

  it('rend null pour un modèle hors grille au lieu d’un coût de zéro', () => {
    expect(tarif('modele-inexistant')).toBeNull();
    expect(coutUsd('modele-inexistant', 1000, 1000)).toBeNull();
  });

  it('chiffre le coût au tarif publié', () => {
    // 1 M de tokens d'entrée à 5 $ + 1 M de sortie à 25 $.
    expect(coutUsd('claude-opus-5', 1_000_000, 1_000_000)).toBeCloseTo(30, 6);
  });

  it('tarifie tous les modèles proposés dans l’interface', () => {
    // Un modèle listé mais non tarifé afficherait « coût inconnu » à
    // l'utilisateur : autant s'assurer que la grille suit la liste.
    for (const fournisseur of FOURNISSEURS_LLM) {
      for (const modele of MODELES_PAR_FOURNISSEUR[fournisseur]) {
        expect(tarif(modele), `${fournisseur} / ${modele}`).not.toBeNull();
      }
    }
  });

  it('expose un adaptateur pour chaque fournisseur annoncé', () => {
    for (const fournisseur of FOURNISSEURS_LLM) {
      const implementation = adaptateur(fournisseur);
      expect(implementation.code).toBe(fournisseur);
      expect(implementation.modeles.length).toBeGreaterThan(0);
    }
  });

  it('n’exige une clé que des fournisseurs distants', () => {
    expect(adaptateur('mock').necessiteCle).toBe(false);
    expect(adaptateur('deepseek').necessiteCle).toBe(true);
    expect(adaptateur('mistral').necessiteCle).toBe(true);
  });
});

describe('sources de recherche', () => {
  it('n’ouvre le web qu’aux rôles dont la matière est hors du graphique', () => {
    expect(rechercheAutorisee('ANALYSTE_MACRO')).toBe(true);
    expect(rechercheAutorisee('ANALYSTE_SENTIMENT')).toBe(true);
    expect(rechercheAutorisee('ANALYSTE_FONDAMENTAL')).toBe(true);
    // L'analyste technique a déjà tout dans l'instantané : chaque requête
    // coûterait des tokens sans rien apporter.
    expect(rechercheAutorisee('ANALYSTE_TECHNIQUE')).toBe(false);
    expect(rechercheAutorisee('TRADER')).toBe(false);
  });

  it('restreint la recherche à des domaines nommés', () => {
    const domaines = domainesPour('ANALYSTE_MACRO');
    expect(domaines.length).toBeGreaterThan(5);
    expect(domaines).toContain('federalreserve.gov');
    expect(domaines).toContain('ecb.europa.eu');
  });

  it('ne laisse aucun domaine aux rôles sans droit de recherche', () => {
    expect(domainesPour('ANALYSTE_TECHNIQUE')).toEqual([]);
  });

  it('exige une date sur toute affirmation tirée du web', () => {
    // Une nouvelle non datée est inutilisable pour trader : « la dernière
    // décision de la Fed » peut désigner celle de l'an dernier.
    expect(CONSIGNE_RECHERCHE).toMatch(/date/i);
    expect(CONSIGNE_RECHERCHE).toMatch(/aucune information vérifiable/i);
  });

  it('écarte explicitement les contenus qui promettent des rendements', () => {
    expect(CONSIGNE_RECHERCHE).toMatch(/rendements/i);
  });
});

describe('adaptateur de simulation', () => {
  const demande = {
    modele: 'mock-1',
    systeme: 'Tu es trader.',
    messages: [{ role: 'utilisateur' as const, contenu: 'Que fais-tu ?' }],
    tokensMax: 1000,
    temperature: null,
    contexteDeterministe: {
      symbole: 'EURUSD',
      dernierPrix: 1.08,
      atr: 0.001,
      decimales: 5,
    },
  };

  it('rend la même sortie pour la même entrée', async () => {
    const a = await adaptateurMock.appeler({ ...demande, formatJson: 'proposition' }, {});
    const b = await adaptateurMock.appeler({ ...demande, formatJson: 'proposition' }, {});
    expect(a.contenu).toBe(b.contenu);
  });

  it('produit une proposition ancrée sur l’instantané, jamais un prix inventé', async () => {
    const reponse = await adaptateurMock.appeler({ ...demande, formatJson: 'proposition' }, {});
    const lecture = analyser(schemaProposition, reponse.contenu);

    expect(lecture.ok).toBe(true);
    if (lecture.ok && lecture.valeur?.action === 'ORDRE') {
      expect(verifierAncrage(lecture.valeur, INSTANTANE).ok).toBe(true);
    }
  });

  it('ne coûte rien : c’est ce qui permet de tout essayer sans clé', async () => {
    const reponse = await adaptateurMock.appeler(demande, {});
    expect(coutUsd(reponse.modele, reponse.tokensEntree, reponse.tokensSortie)).toBe(0);
  });

  it('rend une vue de marché exploitable par le directeur de recherche', async () => {
    const reponse = await adaptateurMock.appeler({ ...demande, formatJson: 'vue_marche' }, {});
    expect(analyser(schemaVueMarche, reponse.contenu).ok).toBe(true);
  });
});
