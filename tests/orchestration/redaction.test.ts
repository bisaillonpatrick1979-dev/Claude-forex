import { describe, expect, it } from 'vitest';

import { redacteurProgressif } from '@/lib/orchestration/redaction';

/**
 * Le rédacteur progressif a une seule responsabilité difficile : ne jamais
 * laisser une écriture partielle atterrir après l'écriture définitive. Le reste
 * — la cadence — n'est qu'une économie de bande passante.
 */

/** Horloge manuelle : les tests ne doivent pas attendre pour vérifier un délai. */
function horloge(depart = 0) {
  let valeur = depart;
  return {
    maintenant: () => valeur,
    avancer: (millisecondes: number) => {
      valeur += millisecondes;
    },
  };
}

/** Écriture instrumentée, dont on contrôle le moment de résolution. */
function collecteur() {
  const ecrits: string[] = [];
  let liberer: (() => void) | null = null;

  return {
    ecrits,
    /** Bloque la prochaine écriture jusqu'à `libere()`. */
    suspendre() {
      return new Promise<void>((resoudre) => {
        liberer = resoudre;
      });
    },
    libere() {
      liberer?.();
      liberer = null;
    },
    async ecrire(texte: string) {
      ecrits.push(texte);
    },
  };
}

const LONG = 'a'.repeat(40);

describe('redacteurProgressif', () => {
  it('n’écrit pas tant que le texte est trop court', async () => {
    const temps = horloge();
    const cible = collecteur();
    const redacteur = redacteurProgressif({
      ecrire: cible.ecrire,
      maintenant: temps.maintenant,
    });

    temps.avancer(10_000);
    redacteur.pousser('court');

    expect(cible.ecrits).toEqual([]);
    await redacteur.cloturer();
  });

  it('n’écrit pas tant que l’intervalle n’est pas écoulé, même sur un long texte', async () => {
    const temps = horloge();
    const cible = collecteur();
    const redacteur = redacteurProgressif({
      ecrire: cible.ecrire,
      maintenant: temps.maintenant,
    });

    redacteur.pousser(LONG);

    expect(cible.ecrits).toEqual([]);
    await redacteur.cloturer();
  });

  it('écrit quand les deux conditions sont réunies', async () => {
    const temps = horloge();
    const cible = collecteur();
    const redacteur = redacteurProgressif({
      ecrire: cible.ecrire,
      maintenant: temps.maintenant,
    });

    temps.avancer(1_000);
    redacteur.pousser(LONG);

    expect(cible.ecrits).toEqual([LONG]);
    await redacteur.cloturer();
  });

  it('ne lance jamais deux écritures en parallèle', async () => {
    const temps = horloge();
    const cible = collecteur();
    const attente = cible.suspendre();

    const redacteur = redacteurProgressif({
      ecrire: async (texte) => {
        cible.ecrits.push(texte);
        await attente;
      },
      maintenant: temps.maintenant,
    });

    temps.avancer(1_000);
    redacteur.pousser(LONG);
    expect(cible.ecrits).toHaveLength(1);

    // Deuxième salve, conditions remplies : elle doit attendre la première.
    temps.avancer(1_000);
    redacteur.pousser(LONG);
    expect(cible.ecrits).toHaveLength(1);

    cible.libere();
    await redacteur.cloturer();
  });

  it('ne mesure la longueur que depuis la dernière écriture', async () => {
    const temps = horloge();
    const cible = collecteur();
    const redacteur = redacteurProgressif({
      ecrire: cible.ecrire,
      maintenant: temps.maintenant,
    });

    temps.avancer(1_000);
    redacteur.pousser(LONG);
    await redacteur.cloturer();

    expect(cible.ecrits).toEqual([LONG]);
  });

  it('n’écrit plus rien après clôture — c’est la course qu’on ferme', async () => {
    const temps = horloge();
    const cible = collecteur();
    const redacteur = redacteurProgressif({
      ecrire: cible.ecrire,
      maintenant: temps.maintenant,
    });

    await redacteur.cloturer();

    temps.avancer(10_000);
    redacteur.pousser(LONG);

    expect(cible.ecrits).toEqual([]);
  });

  it('attend l’écriture en vol avant de rendre la main', async () => {
    const temps = horloge();
    const ecrits: string[] = [];
    let liberer: (() => void) = () => undefined;
    const attente = new Promise<void>((resoudre) => {
      liberer = resoudre;
    });

    const redacteur = redacteurProgressif({
      ecrire: async (texte) => {
        await attente;
        ecrits.push(texte);
      },
      maintenant: temps.maintenant,
    });

    temps.avancer(1_000);
    redacteur.pousser(LONG);
    expect(ecrits).toEqual([]);

    const cloture = redacteur.cloturer();
    liberer();
    await cloture;

    // Si `cloturer` ne l'attendait pas, l'appelant écrirait le texte définitif
    // pendant que ce fragment est encore en route.
    expect(ecrits).toEqual([LONG]);
  });

  it('accumule le texte sans en perdre un caractère', async () => {
    const temps = horloge();
    const cible = collecteur();
    const redacteur = redacteurProgressif({
      ecrire: cible.ecrire,
      maintenant: temps.maintenant,
    });

    for (const morceau of ['Le ', 'marché ', 'ouvre ', 'à ', 'Londres.']) {
      temps.avancer(1_000);
      redacteur.pousser(morceau);
    }

    expect(redacteur.texte()).toBe('Le marché ouvre à Londres.');
    await redacteur.cloturer();
  });

  it('avale les erreurs d’écriture : un fil qui bégaie n’arrête pas un cycle', async () => {
    const temps = horloge();
    const redacteur = redacteurProgressif({
      ecrire: () => Promise.reject(new Error('Realtime indisponible')),
      maintenant: temps.maintenant,
    });

    temps.avancer(1_000);
    redacteur.pousser(LONG);

    await expect(redacteur.cloturer()).resolves.toBeUndefined();
    expect(redacteur.texte()).toBe(LONG);
  });

  it('ignore un fragment vide plutôt que de dépenser une écriture', async () => {
    const temps = horloge();
    const cible = collecteur();
    const redacteur = redacteurProgressif({
      ecrire: cible.ecrire,
      maintenant: temps.maintenant,
    });

    temps.avancer(1_000);
    redacteur.pousser('');

    expect(cible.ecrits).toEqual([]);
    expect(redacteur.texte()).toBe('');
    await redacteur.cloturer();
  });
});
