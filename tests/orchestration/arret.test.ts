import { describe, expect, it } from 'vitest';

import { etatArret } from '@/lib/orchestration/arret';

/**
 * Le kill switch annonçait « agents arrêtés » sans arrêter les agents : rien ne
 * consultait `gele` avant de lancer un cycle. Les agents délibéraient et
 * facturaient, pour produire des propositions que les garde-fous rejetaient
 * toutes. Ces tests fixent le contrat que les trois points d'entrée — veille,
 * lancement manuel, ordonnanceur — consultent désormais.
 */

function client(reponse: { gele: boolean } | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: reponse, error: null }),
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('état d’arrêt', () => {
  it('laisse passer quand le portefeuille n’est pas gelé', async () => {
    const etat = await etatArret(client({ gele: false }), 'profil');
    expect(etat.gele).toBe(false);
    expect(etat.raison).toBeNull();
  });

  it('arrête et explique quand le portefeuille est gelé', async () => {
    const etat = await etatArret(client({ gele: true }), 'profil');
    expect(etat.gele).toBe(true);
    expect(etat.raison).toMatch(/kill switch/i);
    // La raison doit dire comment repartir : un arrêt sans porte de sortie
    // envoie chercher dans le code.
    expect(etat.raison).toMatch(/dégel/i);
  });

  it('considère la firme arrêtée quand le portefeuille est introuvable', async () => {
    // Défaut fermé : mieux vaut ne rien lancer que délibérer sur un compte
    // qui n'existe pas.
    const etat = await etatArret(client(null), 'profil');
    expect(etat.gele).toBe(true);
    expect(etat.raison).toMatch(/portefeuille/i);
  });
});
