import { describe, expect, it } from 'vitest';

import { importerHistorique } from '@/lib/marche/import-historique';
import { dureeSecondes } from '@/lib/marche/intervalles';

import { fauxClient, type Donnees, type Ligne } from '../aides/faux-supabase';

/**
 * L'import remonte le temps par tranches. Deux façons de le rater coûtent cher
 * et ne se voient pas à la lecture : redemander éternellement la même fenêtre
 * (le quota de la journée part en quelques secondes), et vider le quota au
 * point que la salle des marchés n'ait plus de données jusqu'au lendemain.
 * Ces deux cas ont un test chacun.
 */

const PROFIL = 'profil-test';
const SYMBOLE_ID = 'sym-eurusd';
const MAINTENANT = Math.floor(Date.UTC(2026, 6, 22) / 1000);
const AN = 365 * 86_400;

function symboles(): Ligne[] {
  return [
    {
      id: SYMBOLE_ID,
      code: 'EURUSD',
      libelle: 'Euro / Dollar US',
      classe_actif: 'FOREX',
      decimales: 5,
      actif: true,
      correspondances_symboles: [
        { fournisseur_code: 'mock', symbole_externe: 'EURUSD' },
        { fournisseur_code: 'yahoo', symbole_externe: 'EURUSD=X' },
      ],
    },
  ];
}

function fournisseur(code: string, surcharge: Ligne = {}): Ligne {
  return {
    profil_id: PROFIL,
    code,
    actif: true,
    quota_limite: 800,
    quota_utilise: 0,
    fenetre_quota: 'JOUR',
    quota_reinitialise_le: new Date(MAINTENANT * 1000).toISOString(),
    priorite_par_classe: { FOREX: 1 },
    ...surcharge,
  };
}

function donnees(surcharge: Partial<Donnees> = {}): Donnees {
  return {
    symboles: symboles(),
    chandeliers: [],
    cles_api: [],
    fournisseurs_donnees: [fournisseur('mock')],
    ...surcharge,
  };
}

function bougiesEcrites(ecritures: readonly { table: string; valeurs: unknown }[]): number {
  return ecritures
    .filter((ecriture) => ecriture.table === 'chandeliers')
    .reduce((total, ecriture) => total + (ecriture.valeurs as unknown[]).length, 0);
}

describe('remontée par tranches', () => {
  it('couvre quinze ans en quotidien et s’arrête à la cible', async () => {
    const { client, ecritures } = fauxClient(donnees());
    const depuis = MAINTENANT - 15 * AN;

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'D1',
      depuis,
      maintenant: MAINTENANT,
      appelsMax: 10,
    });

    expect(rapport.ok).toBe(true);
    expect(rapport.raisonArret).toBe('CIBLE_ATTEINTE');
    expect(rapport.plusAncienne).not.toBeNull();
    // La cible est une borne basse : on ne descend jamais en dessous.
    expect(rapport.plusAncienne!).toBeGreaterThanOrEqual(depuis);
    // Quinze ans de bougies quotidiennes, à quelques jours près.
    expect(rapport.bougiesEcrites).toBeGreaterThan(5_000);
    expect(bougiesEcrites(ecritures)).toBe(rapport.bougiesEcrites);
  });

  it('enchaîne plusieurs tranches quand une seule ne suffit pas', async () => {
    // 5 000 bougies H1 couvrent environ 208 jours : deux ans en exigent cinq.
    const { client } = fauxClient(donnees());

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'H1',
      depuis: MAINTENANT - 2 * AN,
      maintenant: MAINTENANT,
      appelsMax: 20,
    });

    expect(rapport.appels).toBeGreaterThan(1);
    expect(rapport.raisonArret).toBe('CIBLE_ATTEINTE');
  });

  it('ne redemande jamais une bougie déjà obtenue', async () => {
    const { client, ecritures } = fauxClient(donnees());

    await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'H1',
      depuis: MAINTENANT - AN,
      maintenant: MAINTENANT,
      appelsMax: 20,
    });

    const horodatages = ecritures
      .filter((ecriture) => ecriture.table === 'chandeliers')
      .flatMap((ecriture) => (ecriture.valeurs as { horodatage: string }[]))
      .map((ligne) => ligne.horodatage);

    expect(new Set(horodatages).size).toBe(horodatages.length);
  });
});

describe('garde-fous de dépense', () => {
  it('s’arrête au plafond d’appels au lieu de vider le quota', async () => {
    const { client } = fauxClient(donnees());

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'M5',
      depuis: MAINTENANT - 15 * AN,
      maintenant: MAINTENANT,
      appelsMax: 3,
    });

    expect(rapport.appels).toBe(3);
    expect(rapport.raisonArret).toBe('PLAFOND_APPELS');
    expect(rapport.message).toContain('relancer');
  });

  it('respecte le quota restant, et pas seulement le plafond d’appels', async () => {
    // Sept cent quatre-vingt-seize appels déjà consommés sur huit cents : il en
    // reste quatre, quel que soit le plafond demandé.
    const { client } = fauxClient(
      donnees({ fournisseurs_donnees: [fournisseur('mock', { quota_utilise: 796 })] }),
    );

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'M5',
      depuis: MAINTENANT - 15 * AN,
      maintenant: MAINTENANT,
      appelsMax: 100,
    });

    expect(rapport.appels).toBe(4);
    expect(rapport.raisonArret).toBe('QUOTA_EPUISE');
  });
});

describe('choix de la source', () => {
  it('refuse un fournisseur incapable de remonter le temps', async () => {
    // Yahoo raisonne en plage relative : lui demander une tranche du passé
    // renverrait toujours la même fenêtre récente.
    const { client } = fauxClient(
      donnees({ fournisseurs_donnees: [fournisseur('yahoo')] }),
    );

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'D1',
      depuis: MAINTENANT - AN,
      maintenant: MAINTENANT,
    });

    expect(rapport.ok).toBe(false);
    expect(rapport.appels).toBe(0);
    expect(rapport.message).toMatch(/Twelve Data/);
  });

  it('nomme le fournisseur imposé quand il n’est pas utilisable', async () => {
    const { client } = fauxClient(donnees());

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'D1',
      depuis: MAINTENANT - AN,
      fournisseur: 'twelvedata',
      maintenant: MAINTENANT,
    });

    expect(rapport.ok).toBe(false);
    expect(rapport.message).toContain('twelvedata');
  });

  it('refuse un symbole absent du référentiel sans dépenser un appel', async () => {
    const { client } = fauxClient(donnees());

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'INEXISTANT',
      intervalle: 'D1',
      depuis: MAINTENANT - AN,
      maintenant: MAINTENANT,
    });

    expect(rapport.ok).toBe(false);
    expect(rapport.appels).toBe(0);
  });
});

describe('intégrité de ce qui est écrit', () => {
  it('n’écrit rien au-delà de la cible', async () => {
    const { client, ecritures } = fauxClient(donnees());
    const depuis = MAINTENANT - 30 * 86_400;

    await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'H1',
      depuis,
      maintenant: MAINTENANT,
      appelsMax: 5,
    });

    const horodatages = ecritures
      .filter((ecriture) => ecriture.table === 'chandeliers')
      .flatMap((ecriture) => ecriture.valeurs as { horodatage: string }[])
      .map((ligne) => Math.floor(new Date(ligne.horodatage).getTime() / 1000));

    expect(Math.min(...horodatages)).toBeGreaterThanOrEqual(depuis);
    expect(Math.max(...horodatages)).toBeLessThanOrEqual(MAINTENANT);
  });

  it('marque la provenance sur chaque bougie écrite', async () => {
    const { client, ecritures } = fauxClient(donnees());

    await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'D1',
      depuis: MAINTENANT - 60 * 86_400,
      maintenant: MAINTENANT,
    });

    const lignes = ecritures
      .filter((ecriture) => ecriture.table === 'chandeliers')
      .flatMap((ecriture) => ecriture.valeurs as { fournisseur_code: string }[]);

    expect(lignes.length).toBeGreaterThan(0);
    expect(lignes.every((ligne) => ligne.fournisseur_code === 'mock')).toBe(true);
  });

  it('produit des bougies chronologiques et jointives sur toute la période', async () => {
    const { client, ecritures } = fauxClient(donnees());
    const duree = dureeSecondes('D1');

    await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'D1',
      depuis: MAINTENANT - 200 * 86_400,
      maintenant: MAINTENANT,
    });

    const horodatages = ecritures
      .filter((ecriture) => ecriture.table === 'chandeliers')
      .flatMap((ecriture) => ecriture.valeurs as { horodatage: string }[])
      .map((ligne) => Math.floor(new Date(ligne.horodatage).getTime() / 1000))
      .sort((a, b) => a - b);

    for (let index = 1; index < horodatages.length; index += 1) {
      expect(horodatages[index]! - horodatages[index - 1]!).toBe(duree);
    }
  });
});
