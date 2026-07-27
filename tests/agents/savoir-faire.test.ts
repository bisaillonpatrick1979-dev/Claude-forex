import { describe, expect, it } from 'vitest';

import { rendreSavoirFaire, savoirFaire } from '@/lib/agents/savoir-faire';
import type { Database } from '@/types/base-de-donnees';

type RoleAgent = Database['public']['Enums']['role_agent'];

const ROLES: readonly RoleAgent[] = [
  'ANALYSTE_TECHNIQUE',
  'ANALYSTE_MACRO',
  'ANALYSTE_FONDAMENTAL',
  'ANALYSTE_SENTIMENT',
  'ANALYSTE_VOLATILITE',
  'CHERCHEUR_HAUSSIER',
  'CHERCHEUR_BAISSIER',
  'DIRECTEUR_RECHERCHE',
  'TRADER',
  'GESTIONNAIRE_RISQUE',
  'GESTIONNAIRE_PORTEFEUILLE',
  'AGENT_REFLEXION',
];

/**
 * La méthode est du code versionné, contrairement au mandat que l'utilisateur
 * peut réécrire. Ces tests garantissent qu'elle reste complète et qu'elle
 * continue de dire les choses qui comptent — notamment celles qui vont contre
 * l'envie naturelle d'un agent de conclure quelque chose.
 */

describe('couverture', () => {
  it('donne une méthode aux douze rôles', () => {
    for (const role of ROLES) {
      const methode = savoirFaire(role);
      expect(methode.grille.length, role).toBeGreaterThanOrEqual(4);
      expect(methode.piegesConnus.length, role).toBeGreaterThan(0);
    }
  });

  it('numérote la grille et annonce les pièges dans le rendu', () => {
    const rendu = rendreSavoirFaire('ANALYSTE_TECHNIQUE');
    expect(rendu).toMatch(/^MÉTHODE DE LA MAISON POUR CE POSTE/);
    expect(rendu).toMatch(/1\. Structure/);
    expect(rendu).toMatch(/se trompe habituellement/);
  });
});

describe('ce que la méthode impose', () => {
  it('autorise l’analyste technique à conclure qu’il n’y a rien à voir', () => {
    // Sans cette permission explicite, un modèle trouve toujours une figure.
    const rendu = rendreSavoirFaire('ANALYSTE_TECHNIQUE');
    expect(rendu).toMatch(/« Pas claire » est une conclusion complète|pas de structure exploitable/i);
  });

  it('oblige l’analyste volatilité à un verdict explicite', () => {
    const rendu = rendreSavoirFaire('ANALYSTE_VOLATILITE');
    expect(rendu).toMatch(/FAVORABLES/);
    expect(rendu).toMatch(/HOSTILES/);
    // Le rôle existe pour dire non : une majorité de « favorable » est un
    // signe que l'agent ne fait pas son travail, et il doit le savoir.
    expect(rendu).toMatch(/quand il ne faut PAS trader/);
  });

  it('impose au trader de placer le stop à l’invalidation, pas au budget', () => {
    const rendu = rendreSavoirFaire('TRADER');
    expect(rendu).toMatch(/invalidation d’abord, entrée ensuite/i);
    expect(rendu).toMatch(/l’erreur la plus coûteuse du métier/);
  });

  it('exige des chercheurs un niveau qui invalide leur thèse', () => {
    for (const role of ['CHERCHEUR_HAUSSIER', 'CHERCHEUR_BAISSIER'] as const) {
      const rendu = rendreSavoirFaire(role);
      expect(rendu, role).toMatch(/sans invalidation n’est pas une thèse/);
      expect(rendu, role).toMatch(/défaut structurel du rôle/);
    }
  });

  it('rappelle au directeur que NEUTRE n’est pas un compromis', () => {
    const rendu = rendreSavoirFaire('DIRECTEUR_RECHERCHE');
    expect(rendu).toMatch(/NEUTRE doit être une conclusion, pas un compromis/);
  });

  it('apprend à l’agent de réflexion à distinguer l’erreur du hasard', () => {
    // Tirer une leçon d'un simple aléa fait désapprendre : c'est le piège
    // central du post-mortem.
    const rendu = rendreSavoirFaire('AGENT_REFLEXION');
    expect(rendu).toMatch(/erreur de méthode, ou au hasard ordinaire/);
    expect(rendu).toMatch(/fait désapprendre/);
  });
});

describe('périmètres', () => {
  it('interdit aux analystes de proposer des niveaux d’ordre', () => {
    for (const role of ['ANALYSTE_MACRO', 'ANALYSTE_FONDAMENTAL', 'ANALYSTE_SENTIMENT'] as const) {
      expect(savoirFaire(role).horsPerimetre.join(' '), role).toMatch(/niveau|ordre/i);
    }
  });

  it('rappelle au risque et au portefeuille qu’ils ne peuvent pas élargir une limite', () => {
    expect(rendreSavoirFaire('GESTIONNAIRE_RISQUE')).toMatch(/jamais l’élargir/);
    expect(rendreSavoirFaire('GESTIONNAIRE_PORTEFEUILLE')).toMatch(/jamais augmenter la taille/);
  });

  it('sépare le technique du macro', () => {
    expect(savoirFaire('ANALYSTE_TECHNIQUE').horsPerimetre.join(' ')).toMatch(/analyste macro/);
  });
});
