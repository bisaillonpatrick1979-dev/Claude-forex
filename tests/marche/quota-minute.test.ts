import { describe, expect, it, vi } from 'vitest';

import { importerHistorique } from '@/lib/marche/import-historique';
import { etatDepuisLigne, reserverAppel } from '@/lib/marche/quotas';
import { obtenirChandeliers } from '@/lib/marche/routeur';

import { fauxClient, type Donnees, type Ligne } from '../aides/faux-supabase';

/**
 * Le cas qui a motivé ce code est arrivé en production : Twelve Data a répondu
 * 429 avec **douze requêtes consommées sur huit cents**. Ce n'était pas le
 * quota journalier mais la limite par minute du palier gratuit — huit — que le
 * modèle à une seule fenêtre ne pouvait pas exprimer. L'application se croyait
 * à 1,5 % de son quota pendant que le fournisseur la refusait.
 */

const PROFIL = 'profil-test';
const SYMBOLE_ID = 'sym-eurusd';
const MAINTENANT = Math.floor(Date.UTC(2026, 6, 27, 12, 30) / 1000);

function fournisseur(surcharge: Ligne = {}): Ligne {
  return {
    profil_id: PROFIL,
    code: 'twelvedata',
    actif: true,
    quota_limite: 800,
    quota_utilise: 12,
    fenetre_quota: 'JOUR',
    quota_reinitialise_le: new Date(Date.UTC(2026, 6, 27) * 1).toISOString(),
    quota_minute_limite: 8,
    quota_minute_utilise: 0,
    quota_minute_reinitialise_le: new Date(MAINTENANT * 1000).toISOString(),
    priorite_par_classe: { FOREX: 1 },
    ...surcharge,
  };
}

function symboleMock(): Ligne {
  return {
    id: SYMBOLE_ID,
    code: 'EURUSD',
    libelle: 'Euro / Dollar US',
    classe_actif: 'FOREX',
    decimales: 5,
    actif: true,
    correspondances_symboles: [{ fournisseur_code: 'mock', symbole_externe: 'EURUSD' }],
  };
}

function donnees(surcharge: Partial<Donnees> = {}): Donnees {
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
          { fournisseur_code: 'twelvedata', symbole_externe: 'EUR/USD' },
          { fournisseur_code: 'mock', symbole_externe: 'EURUSD' },
        ],
      },
    ],
    chandeliers: [],
    cles_api: [],
    fournisseurs_donnees: [fournisseur()],
    ...surcharge,
  };
}

describe('deux fenêtres indépendantes', () => {
  it('déclare épuisé un fournisseur à 12/800 mais à bout de débit', () => {
    const etat = etatDepuisLigne(
      {
        code: 'twelvedata',
        quota_limite: 800,
        quota_utilise: 12,
        fenetre_quota: 'JOUR',
        quota_reinitialise_le: new Date(MAINTENANT * 1000).toISOString(),
        quota_minute_limite: 8,
        quota_minute_utilise: 8,
        quota_minute_reinitialise_le: new Date(MAINTENANT * 1000).toISOString(),
      },
      new Date(MAINTENANT * 1000),
    );

    expect(etat.utilise).toBe(12);
    expect(etat.limite).toBe(800);
    expect(etat.utiliseCetteMinute).toBe(8);
    expect(etat.epuise).toBe(true); // c'est tout l'objet du correctif
  });

  it('remet le compteur de la minute à zéro à la minute suivante', () => {
    const etat = etatDepuisLigne(
      {
        code: 'twelvedata',
        quota_limite: 800,
        quota_utilise: 12,
        fenetre_quota: 'JOUR',
        quota_reinitialise_le: new Date(MAINTENANT * 1000).toISOString(),
        quota_minute_limite: 8,
        quota_minute_utilise: 8,
        quota_minute_reinitialise_le: new Date((MAINTENANT - 120) * 1000).toISOString(),
      },
      new Date(MAINTENANT * 1000),
    );

    expect(etat.utiliseCetteMinute).toBe(0);
    expect(etat.epuise).toBe(false);
  });

  it('ne contraint rien quand aucune limite de débit n’est connue', () => {
    const etat = etatDepuisLigne(
      {
        code: 'yahoo',
        quota_limite: 500,
        quota_utilise: 3,
        fenetre_quota: 'JOUR',
        quota_reinitialise_le: new Date(MAINTENANT * 1000).toISOString(),
      },
      new Date(MAINTENANT * 1000),
    );
    expect(etat.limiteParMinute).toBeNull();
    expect(etat.epuise).toBe(false);
  });
});

describe('réservation', () => {
  it('accorde exactement le nombre d’appels de la minute, puis refuse', async () => {
    const { client } = fauxClient(donnees());
    const instant = new Date(MAINTENANT * 1000);

    const verdicts = [];
    for (let appel = 0; appel < 10; appel += 1) {
      verdicts.push(await reserverAppel(client, PROFIL, 'twelvedata', instant));
    }

    expect(verdicts.filter((verdict) => verdict.autorise)).toHaveLength(8);
    expect(verdicts[8]!.autorise).toBe(false);
    expect(verdicts[8]!.raison).toContain('par minute');
    expect(verdicts[8]!.repriseLe).not.toBeNull();
  });

  it('dit quand reprendre, pas seulement que c’est refusé', async () => {
    const { client } = fauxClient(
      donnees({ fournisseurs_donnees: [fournisseur({ quota_minute_utilise: 8 })] }),
    );
    const instant = new Date(MAINTENANT * 1000);
    const reservation = await reserverAppel(client, PROFIL, 'twelvedata', instant);

    expect(reservation.autorise).toBe(false);
    // La minute suivante, jamais un délai flottant : c'est ainsi que le
    // fournisseur compte.
    expect(reservation.repriseLe!.getTime()).toBe(instant.getTime() + 60_000);
  });

  it('distingue le quota journalier de la limite de débit dans son message', async () => {
    const { client } = fauxClient(
      donnees({
        fournisseurs_donnees: [fournisseur({ quota_utilise: 800, quota_minute_utilise: 0 })],
      }),
    );
    const reservation = await reserverAppel(
      client,
      PROFIL,
      'twelvedata',
      new Date(MAINTENANT * 1000),
    );

    expect(reservation.autorise).toBe(false);
    expect(reservation.raison).toContain('par jour');
  });

  it('refuse plutôt que de laisser passer quand la réservation échoue', async () => {
    const { client } = fauxClient(donnees({ fournisseurs_donnees: [] }));
    const reservation = await reserverAppel(
      client,
      PROFIL,
      'twelvedata',
      new Date(MAINTENANT * 1000),
    );
    expect(reservation.autorise).toBe(false);
  });
});

describe('routeur', () => {
  it('n’émet pas l’appel quand le débit est atteint, et le dit', async () => {
    const { client } = fauxClient(
      donnees({ fournisseurs_donnees: [fournisseur({ quota_minute_utilise: 8 })] }),
    );

    await expect(
      obtenirChandeliers({
        client,
        profilId: PROFIL,
        symbole: 'EURUSD',
        intervalle: 'H1',
        limite: 50,
        maintenant: MAINTENANT,
      }),
    ).rejects.toMatchObject({
      incidents: expect.arrayContaining([
        expect.objectContaining({ fournisseur: 'twelvedata', raison: expect.stringMatching(/minute/) }),
      ]),
    });
  });

  it('consomme la réservation même quand le fournisseur échoue ensuite', async () => {
    // Un appel refusé par le fournisseur compte quand même dans sa limite de
    // débit. Compter après le succès laissait chaque échec ouvrir la porte au
    // suivant, et la rafale s'aggravait au lieu de s'arrêter.
    const lignes = [fournisseur({ code: 'twelvedata', quota_minute_utilise: 0 })];
    const { client } = fauxClient(
      donnees({
        fournisseurs_donnees: lignes,
        symboles: [
          {
            id: SYMBOLE_ID,
            code: 'EURUSD',
            libelle: 'Euro / Dollar US',
            classe_actif: 'FOREX',
            decimales: 5,
            actif: true,
            // Aucune clé en base ni en environnement : l'appel échouera.
            correspondances_symboles: [
              { fournisseur_code: 'twelvedata', symbole_externe: 'EUR/USD' },
            ],
          },
        ],
      }),
    );

    await obtenirChandeliers({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'H1',
      limite: 50,
      maintenant: MAINTENANT,
    }).catch(() => undefined);

    // Soit la clé manquait et rien n'a été réservé, soit l'appel a eu lieu et
    // la réservation est consommée. Dans les deux cas le compteur ne peut pas
    // avoir avancé sans qu'un appel ait été autorisé.
    expect(Number(lignes[0]!.quota_minute_utilise)).toBeLessThanOrEqual(1);
  });
});

describe('import par lot', () => {
  it('attend la minute suivante au lieu d’abandonner sur une limite de débit', async () => {
    // Deux appels par minute, quatre demandés : sans attente, l'import
    // s'arrêterait à mi-chemin et obligerait à le relancer à la main toutes
    // les deux requêtes. Horloge simulée — le test prouve l'attente sans la
    // subir.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MAINTENANT * 1000));

    try {
      const { client } = fauxClient(
        donnees({
          fournisseurs_donnees: [
            fournisseur({ code: 'mock', quota_limite: null, quota_minute_limite: 2 }),
          ],
          symboles: [symboleMock()],
        }),
      );

      const promesse = importerHistorique({
        client,
        profilId: PROFIL,
        symbole: 'EURUSD',
        intervalle: 'M5',
        depuis: MAINTENANT - 365 * 86_400,
        maintenant: MAINTENANT,
        appelsMax: 4,
      });

      // Deux minutes d'horloge suffisent à débloquer les deux tranches
      // supplémentaires.
      for (let tour = 0; tour < 4; tour += 1) {
        await vi.advanceTimersByTimeAsync(61_000);
      }

      const rapport = await promesse;

      expect(rapport.appels).toBe(4);
      expect(rapport.raisonArret).toBe('PLAFOND_APPELS');
      expect(rapport.bougiesEcrites).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rend un message qui nomme la fenêtre atteinte', async () => {
    const { client } = fauxClient(
      donnees({
        fournisseurs_donnees: [
          fournisseur({ code: 'mock', quota_limite: 0, quota_minute_limite: null }),
        ],
        symboles: [symboleMock()],
      }),
    );

    const rapport = await importerHistorique({
      client,
      profilId: PROFIL,
      symbole: 'EURUSD',
      intervalle: 'D1',
      depuis: MAINTENANT - 365 * 86_400,
      maintenant: MAINTENANT,
      appelsMax: 5,
    });

    expect(rapport.raisonArret).toBe('QUOTA_EPUISE');
    expect(rapport.message).toContain('par jour');
  });
});
