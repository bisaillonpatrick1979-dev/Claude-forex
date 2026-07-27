import { describe, expect, it } from 'vitest';

import { executerBacktest, type Decideur, type VueDecision } from '@/lib/backtest/moteur';
import { dureeSecondes } from '@/lib/marche/intervalles';
import type { Chandelier } from '@/lib/marche/types';

import { EURUSD } from '../aides/instruments';

/**
 * Le test qui justifie l'existence du reste.
 *
 * Un backtest qui laisse fuiter le futur produit des courbes magnifiques et
 * ruine celui qui les croit. La fuite ne s'annonce pas : elle prend la forme
 * d'un indicateur calculé sur la série entière, d'un ordre rempli au cours de
 * la bougie qui l'a déclenché, d'un stop placé à un niveau qu'on ne connaît
 * qu'après coup. Aucune de ces trois erreurs ne fait échouer un test ordinaire
 * — le backtest tourne, rend des chiffres, et ment.
 *
 * On ne vérifie donc pas que le moteur est bien intentionné : on lui donne un
 * décideur qui **essaie explicitement de tricher** et on constate qu'il n'y
 * arrive pas.
 */

const H1 = dureeSecondes('H1');
const DEBUT = Math.floor(Date.UTC(2026, 0, 5) / 1000);

/**
 * Série en vagues de quatre bougies : deux à un palier, deux à l'autre.
 *
 * La forme est choisie pour que la fenêtre exacte qu'exploiterait un tricheur —
 * de l'ouverture de la bougie N+1 à la clôture de N+2, c'est-à-dire là où un
 * ordre décidé en N vit réellement — traverse un changement de palier. Une
 * alternance simple ne conviendrait pas : ses deux bornes tombent au même
 * niveau, et même en voyant l'avenir on n'y gagnerait rien. Le test passerait
 * alors pour de mauvaises raisons.
 */
function vagues(nombre: number): Chandelier[] {
  const palier = (rang: number): number => 1.1 + 0.04 * (Math.floor(rang / 2) % 2);
  return Array.from({ length: nombre }, (_, index) => {
    const ouverture = palier(index);
    const cloture = palier(index + 1);
    return {
      horodatage: DEBUT + index * H1,
      ouverture,
      haut: Math.max(ouverture, cloture) + 0.001,
      bas: Math.min(ouverture, cloture) - 0.001,
      cloture,
      volume: 1000,
    };
  });
}

function backtest(decideur: Decideur, bougies = vagues(200)) {
  return executerBacktest({
    chandeliers: bougies,
    instrument: EURUSD,
    intervalle: 'H1',
    capitalInitial: 100_000,
    decideur,
    echauffement: 20,
  });
}

describe('barrière d’information', () => {
  it('ne montre jamais au décideur une bougie postérieure à la sienne', () => {
    const vues: VueDecision[] = [];
    backtest((vue) => {
      vues.push(vue);
      return {};
    });

    expect(vues.length).toBeGreaterThan(0);
    for (const vue of vues) {
      const derniere = vue.bougies[vue.bougies.length - 1]!;
      expect(derniere.horodatage).toBe(vue.bougie.horodatage);
      expect(vue.bougies.every((b) => b.horodatage <= vue.bougie.horodatage)).toBe(true);
    }
  });

  it('donne exactement index + 1 bougies, jamais la série entière', () => {
    const tailles: number[] = [];
    backtest((vue) => {
      tailles.push(vue.bougies.length);
      return {};
    });

    expect(tailles.every((taille, rang) => taille === rang + 21)).toBe(true);
    expect(Math.max(...tailles)).toBeLessThan(200);
  });
});

describe('barrière d’exécution', () => {
  it('ne remplit aucun ordre sur la bougie qui l’a décidé', () => {
    const decisions: number[] = [];
    const resultat = backtest((vue) => {
      if (vue.positions.length > 0 || vue.ordresEnAttente.length > 0) return {};
      decisions.push(vue.bougie.horodatage);
      return { ordres: [{ sens: 'ACHAT', quantite: 0.1 }] };
    });

    const remplissages = resultat.evenements.filter((e) => e.type === 'ORDRE_REMPLI');
    expect(remplissages.length).toBeGreaterThan(0);
    for (const remplissage of remplissages) {
      expect(decisions).not.toContain(remplissage.horodatage);
    }
  });

  it('ne laisse pas non plus fermer une position au cours de la bougie décidée', () => {
    const fermeturesDemandees: number[] = [];
    const resultat = backtest((vue) => {
      if (vue.positions.length === 0) {
        return vue.ordresEnAttente.length > 0 ? {} : { ordres: [{ sens: 'ACHAT', quantite: 0.1 }] };
      }
      fermeturesDemandees.push(vue.bougie.horodatage);
      return { fermetures: vue.positions.map((position) => ({ positionId: position.id })) };
    });

    const fermetures = resultat.evenements.filter((e) => e.type === 'POSITION_FERMEE');
    expect(fermetures.length).toBeGreaterThan(0);
    for (const fermeture of fermetures) {
      // La fermeture a bien lieu après la bougie où elle a été demandée.
      expect(fermeture.horodatage).toBeGreaterThan(Math.min(...fermeturesDemandees));
    }
  });
});

describe('le tricheur ne gagne rien', () => {
  /**
   * Ce décideur essaie de lire la bougie suivante dans sa propre vue. Sur une
   * série en dents de scie, y parvenir rendrait une fortune : il achèterait à
   * chaque creux et vendrait à chaque sommet, sans jamais se tromper.
   */
  it('ne peut pas exploiter la bougie suivante, parce qu’elle n’est pas là', () => {
    const serie = vagues(200);

    const tricheur: Decideur = (vue) => {
      const suivante = (vue.bougies as Chandelier[])[vue.index + 1];
      if (!suivante) return {}; // le cas normal : elle n'existe pas
      const monte = suivante.cloture > vue.bougie.cloture;
      return { ordres: [{ sens: monte ? 'ACHAT' : 'VENTE', quantite: 1 }] };
    };

    const resultat = backtest(tricheur, serie);

    // Aucun ordre n'a pu être passé : la tentative n'a jamais eu de matière.
    expect(resultat.trades).toHaveLength(0);
    expect(resultat.etatFinal.portefeuille.equite).toBe(100_000);
  });

  /**
   * Même stratégie, mais nourrie de l'extérieur avec la série complète — la
   * fuite qu'on veut rendre impossible. Le contraste chiffre ce qui serait
   * perdu si la barrière tombait.
   */
  it('gagnerait massivement si la série complète lui était donnée', () => {
    const serie = vagues(200);

    const avecFuite: Decideur = (vue) => {
      // Une position à la fois, gardée une bougie : la fenêtre de détention
      // est donc connue d'avance, et le sens est choisi en la lisant.
      if (vue.positions.length > 0) {
        return { fermetures: vue.positions.map((position) => ({ positionId: position.id })) };
      }
      if (vue.ordresEnAttente.length > 0) return {};

      const entree = serie[vue.index + 1];
      const sortie = serie[vue.index + 2];
      if (!entree || !sortie) return {};

      const monte = sortie.cloture > entree.ouverture;
      return { ordres: [{ sens: monte ? 'ACHAT' : 'VENTE', quantite: 1 }] };
    };

    const resultat = backtest(avecFuite, serie);

    // La démonstration : un backtest sans barrière produit ce genre de courbe,
    // et rien dans ses chiffres ne dit qu'elle est fausse.
    expect(resultat.trades.length).toBeGreaterThan(0);
    expect(resultat.etatFinal.portefeuille.equite).toBeGreaterThan(100_000);
  });
});

describe('déroulement', () => {
  it('n’appelle pas le décideur pendant l’échauffement', () => {
    const index: number[] = [];
    backtest((vue) => {
      index.push(vue.index);
      return {};
    });
    expect(Math.min(...index)).toBe(20);
  });

  it('relève l’équité à chaque bougie, pas seulement à la fin', () => {
    const resultat = backtest(() => ({}));
    expect(resultat.courbeEquite).toHaveLength(200);
    expect(resultat.courbeEquite[0]!.horodatage).toBe(DEBUT);
  });

  it('rend le même résultat deux fois pour le même décideur', () => {
    const construire = (): Decideur => {
      let fait = false;
      return (vue) => {
        if (fait || vue.positions.length > 0) return {};
        fait = true;
        return { ordres: [{ sens: 'ACHAT', quantite: 0.5 }] };
      };
    };

    const a = backtest(construire());
    const b = backtest(construire());
    expect(a.etatFinal.portefeuille.equite).toBe(b.etatFinal.portefeuille.equite);
  });
});
