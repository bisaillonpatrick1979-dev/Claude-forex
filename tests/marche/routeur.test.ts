import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErreurDonneesIndisponibles } from '@/lib/marche/erreurs';
import { obtenirChandeliers } from '@/lib/marche/routeur';

import { fauxClient, type Donnees } from '../aides/faux-supabase';

const PROFIL = 'profil-test';
const SYMBOLE_ID = 'sym-eurusd';
const MAINTENANT = 1_785_000_000;

function donneesDeBase(surcharge: Partial<Donnees> = {}): Donnees {
  return {
    symboles: [
      {
        id: SYMBOLE_ID,
        code: 'EURUSD',
        libelle: 'Euro / Dollar US',
        classe_actif: 'FOREX',
        decimales: 5,
        actif: true,
        correspondances_symboles: [
          { fournisseur_code: 'mock', symbole_externe: 'EURUSD' },
          { fournisseur_code: 'twelvedata', symbole_externe: 'EUR/USD' },
          { fournisseur_code: 'yahoo', symbole_externe: 'EURUSD=X' },
        ],
      },
    ],
    chandeliers: [],
    cles_api: [],
    fournisseurs_donnees: [
      {
        profil_id: PROFIL,
        code: 'mock',
        actif: true,
        quota_limite: null,
        quota_utilise: 0,
        fenetre_quota: 'JOUR',
        quota_reinitialise_le: new Date(MAINTENANT * 1000).toISOString(),
        priorite_par_classe: { FOREX: 9 },
      },
    ],
    ...surcharge,
  };
}

function ligneFournisseur(code: string, surcharge: Record<string, unknown> = {}) {
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

const OPTIONS_BASE = {
  profilId: PROFIL,
  symbole: 'EURUSD',
  intervalle: 'M5' as const,
  limite: 10,
  maintenant: MAINTENANT,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routeur — cas nominal', () => {
  it('appelle le fournisseur éligible et met le résultat en cache', async () => {
    const { client, ecritures } = fauxClient(donneesDeBase());

    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE });

    expect(resultat.origine).toBe('FOURNISSEUR');
    expect(resultat.fournisseur).toBe('mock');
    expect(resultat.perime).toBe(false);
    expect(resultat.chandeliers).toHaveLength(10);
    expect(ecritures.some((e) => e.table === 'chandeliers' && e.operation === 'upsert')).toBe(true);
  });

  it('respecte l’ordre de priorité par classe d’actifs', async () => {
    // yahoo en priorité 1, mock en 9 : yahoo doit être tenté en premier.
    const donnees = donneesDeBase({
      fournisseurs_donnees: [
        ...donneesDeBase().fournisseurs_donnees!,
        ligneFournisseur('yahoo', { quota_limite: null }),
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429 })),
    );

    const { client } = fauxClient(donnees);
    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE });

    // Yahoo échoue en 429, la cascade descend sur mock — et l'incident est visible.
    expect(resultat.fournisseur).toBe('mock');
    expect(resultat.incidents.some((incident) => incident.fournisseur === 'yahoo')).toBe(true);
  });
});

describe('routeur — exclusions avant tout appel réseau', () => {
  it('écarte un fournisseur dont le quota est épuisé, sans le contacter', async () => {
    const appel = vi.fn();
    vi.stubGlobal('fetch', appel);

    const donnees = donneesDeBase({
      fournisseurs_donnees: [
        ...donneesDeBase().fournisseurs_donnees!,
        ligneFournisseur('twelvedata', { quota_utilise: 800 }),
      ],
    });
    const { client } = fauxClient(donnees);

    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE });

    expect(appel).not.toHaveBeenCalled();
    expect(resultat.fournisseur).toBe('mock');
    expect(
      resultat.incidents.find((incident) => incident.fournisseur === 'twelvedata')?.raison,
    ).toContain('Quota épuisé');
  });

  it('écarte un fournisseur sans clé API enregistrée', async () => {
    const appel = vi.fn();
    vi.stubGlobal('fetch', appel);

    const donnees = donneesDeBase({
      fournisseurs_donnees: [
        ...donneesDeBase().fournisseurs_donnees!,
        ligneFournisseur('twelvedata'),
      ],
    });
    const { client } = fauxClient(donnees);

    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE });

    expect(appel).not.toHaveBeenCalled();
    expect(
      resultat.incidents.find((incident) => incident.fournisseur === 'twelvedata')?.raison,
    ).toContain('Aucune clé');
  });

  it('écarte un fournisseur incapable de l’intervalle demandé', async () => {
    // Yahoo ne publie pas de 4 heures.
    const donnees = donneesDeBase({
      fournisseurs_donnees: [
        ...donneesDeBase().fournisseurs_donnees!,
        ligneFournisseur('yahoo', { quota_limite: null }),
      ],
    });
    const { client } = fauxClient(donnees);

    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE, intervalle: 'H4' });

    expect(resultat.fournisseur).toBe('mock');
    expect(
      resultat.incidents.find((incident) => incident.fournisseur === 'yahoo')?.raison,
    ).toContain('H4');
  });

  it('écarte un fournisseur sans correspondance de symbole', async () => {
    const donnees = donneesDeBase();
    donnees.symboles![0]!.correspondances_symboles = [
      { fournisseur_code: 'mock', symbole_externe: 'EURUSD' },
    ];
    donnees.fournisseurs_donnees!.push(ligneFournisseur('yahoo', { quota_limite: null }));

    const { client } = fauxClient(donnees);
    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE });

    expect(resultat.fournisseur).toBe('mock');
    expect(
      resultat.incidents.find((incident) => incident.fournisseur === 'yahoo')?.raison,
    ).toContain('correspondance');
  });
});

describe('routeur — cache', () => {
  function cacheAvec(recupereLeSecondes: number, nombre = 10) {
    const lignes = [];
    for (let rang = nombre - 1; rang >= 0; rang -= 1) {
      lignes.push({
        symbole_id: SYMBOLE_ID,
        intervalle: 'M5',
        horodatage: new Date((MAINTENANT - rang * 300) * 1000).toISOString(),
        ouverture: '1.08000',
        haut: '1.08100',
        bas: '1.07900',
        cloture: '1.08050',
        volume: '1000',
        fournisseur_code: 'twelvedata',
        fermee: rang !== 0,
        recupere_le: new Date(recupereLeSecondes * 1000).toISOString(),
      });
    }
    return lignes;
  }

  it('sert le cache frais sans contacter aucun fournisseur', async () => {
    const appel = vi.fn();
    vi.stubGlobal('fetch', appel);

    const { client, ecritures } = fauxClient(
      donneesDeBase({ chandeliers: cacheAvec(MAINTENANT - 10) }),
    );

    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE });

    expect(resultat.origine).toBe('CACHE');
    expect(resultat.perime).toBe(false);
    expect(appel).not.toHaveBeenCalled();
    expect(ecritures.some((e) => e.table === 'chandeliers')).toBe(false);
  });

  it('force l’appel fournisseur quand on demande à ignorer le cache', async () => {
    const { client } = fauxClient(donneesDeBase({ chandeliers: cacheAvec(MAINTENANT - 10) }));

    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE, ignorerCache: true });

    expect(resultat.origine).toBe('FOURNISSEUR');
  });

  /**
   * Dernier étage de la cascade : mieux vaut du périmé annoncé comme tel qu'un
   * écran vide — mais le drapeau doit être posé, sinon l'UI ment.
   */
  it('sert le cache périmé en le marquant quand aucun fournisseur n’est disponible', async () => {
    const donnees = donneesDeBase({ chandeliers: cacheAvec(MAINTENANT - 100_000) });
    donnees.fournisseurs_donnees = []; // aucun fournisseur actif

    const { client } = fauxClient(donnees);
    const resultat = await obtenirChandeliers({ client, ...OPTIONS_BASE });

    expect(resultat.origine).toBe('CACHE_PERIME');
    expect(resultat.perime).toBe(true);
    expect(resultat.chandeliers.length).toBeGreaterThan(0);
  });
});

describe('routeur — échecs explicites', () => {
  it('lève quand il n’y a ni fournisseur ni cache, en listant les tentatives', async () => {
    const donnees = donneesDeBase();
    donnees.fournisseurs_donnees = [];

    const { client } = fauxClient(donnees);

    await expect(obtenirChandeliers({ client, ...OPTIONS_BASE })).rejects.toBeInstanceOf(
      ErreurDonneesIndisponibles,
    );
  });

  it('lève pour un symbole absent du référentiel plutôt que d’inventer une série', async () => {
    const { client } = fauxClient(donneesDeBase());

    await expect(
      obtenirChandeliers({ client, ...OPTIONS_BASE, symbole: 'INEXISTANT' }),
    ).rejects.toThrow(/référentiel/);
  });
});
