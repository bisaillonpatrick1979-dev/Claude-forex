import { debutBougie, dureeSecondes } from '../intervalles';
import type {
  Capacites,
  Chandelier,
  DemandeChandeliers,
  FournisseurDonneesMarche,
  ReponseFournisseur,
  ResultatTest,
} from '../types';

/**
 * Adaptateur de développement et de test.
 *
 * Contrainte forte : **déterministe**. La bougie d'un symbole à un horodatage
 * donné vaut toujours la même chose, quelle que soit la fenêtre demandée et
 * quel que soit le moment de l'appel. Sans ça, le cache et les appels répétés
 * se contrediraient, et un backtest ne serait pas reproductible.
 *
 * La série n'est donc pas une marche aléatoire (qui dépendrait du point de
 * départ) mais un bruit de valeur lissé, évalué à l'index absolu de la bougie.
 */

/** Prix de référence par symbole. Ordres de grandeur réalistes, sans plus. */
const PRIX_BASE: Readonly<Record<string, number>> = {
  EURUSD: 1.08,
  GBPUSD: 1.27,
  USDJPY: 155.0,
  USDCAD: 1.37,
  AUDUSD: 0.66,
  XAUUSD: 2350.0,
  NAS100: 19500.0,
  SPX500: 5400.0,
  AAPL: 210.0,
  MSFT: 440.0,
  NVDA: 125.0,
  BTCUSD: 64000.0,
  ETHUSD: 3400.0,
};

const PRIX_BASE_DEFAUT = 100;

/** Hachage entier 32 bits, sans dépendance externe. */
function hacher(x: number, graine: number): number {
  let h = (x ^ graine) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Valeur pseudo-aléatoire dans [-1, 1], stable pour un couple (index, graine). */
function bruit(index: number, graine: number): number {
  return (hacher(index, graine) / 0xffffffff) * 2 - 1;
}

function adoucir(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bruit interpolé : deux points voisins reliés par une transition douce. */
function bruitLisse(position: number, graine: number): number {
  const bas = Math.floor(position);
  const fraction = position - bas;
  const a = bruit(bas, graine);
  const b = bruit(bas + 1, graine);
  return a + (b - a) * adoucir(fraction);
}

function grainePourSymbole(symbole: string): number {
  let graine = 2166136261;
  for (let i = 0; i < symbole.length; i += 1) {
    graine = Math.imul(graine ^ symbole.charCodeAt(i), 16777619);
  }
  return graine >>> 0;
}

/** Prix théorique à l'index absolu de bougie, en dehors de toute fenêtre. */
function prixA(index: number, base: number, graine: number): number {
  const tendance = bruitLisse(index / 512, graine) * 0.06;
  const cycle = bruitLisse(index / 64, graine ^ 0x9e3779b9) * 0.02;
  const agitation = bruitLisse(index / 8, graine ^ 0x85ebca6b) * 0.006;
  return base * (1 + tendance + cycle + agitation);
}

function arrondir(valeur: number): number {
  const decimales = valeur < 20 ? 5 : 2;
  return Number(valeur.toFixed(decimales));
}

export class FournisseurMock implements FournisseurDonneesMarche {
  readonly code = 'mock' as const;
  readonly nom = 'Mock (déterministe)';

  capacites(): Capacites {
    return {
      classesActifs: ['FOREX', 'INDICE', 'ACTION', 'CRYPTO', 'MATIERE_PREMIERE'],
      intervalles: ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'],
      necessiteCle: false,
      limiteParAppel: 5000,
      fenetreHistorique: true,
    };
  }

  /** Le contexte d'appel (clé, symbole externe) ne sert à rien ici : la série
   *  est calculée localement à partir du symbole interne. */
  async recupererChandeliers(demande: DemandeChandeliers): Promise<ReponseFournisseur> {
    return { chandeliers: genererSerie(demande), retarde: false };
  }

  async tester(): Promise<ResultatTest> {
    return { ok: true, message: 'Adaptateur local, aucun appel réseau.', latenceMs: 0 };
  }
}

/**
 * Exportée séparément : le moteur de backtest (phase 6) et les tests s'en
 * servent sans passer par le routeur.
 */
export function genererSerie(
  demande: DemandeChandeliers,
  maintenant: number = Math.floor(Date.now() / 1000),
): Chandelier[] {
  const base = PRIX_BASE[demande.symbole] ?? PRIX_BASE_DEFAUT;
  const graine = grainePourSymbole(demande.symbole + demande.intervalle);
  const duree = dureeSecondes(demande.intervalle);
  // `avant` est exclusif : la bougie la plus récente rendue est celle qui
  // précède, sinon deux tranches consécutives d'un import se chevaucheraient
  // d'une bougie.
  const plafond = demande.avant === undefined ? maintenant : demande.avant - duree;
  const derniereOuverture = debutBougie(plafond, demande.intervalle);
  const limite = Math.max(1, Math.min(demande.limite, 5000));

  const chandeliers: Chandelier[] = [];
  for (let rang = limite - 1; rang >= 0; rang -= 1) {
    const horodatage = derniereOuverture - rang * duree;
    const index = Math.floor(horodatage / duree);

    const ouverture = prixA(index, base, graine);
    const cloture = prixA(index + 1, base, graine);
    const etendue = Math.abs(bruit(index, graine ^ 0xc2b2ae35)) * base * 0.0015;

    const haut = Math.max(ouverture, cloture) + etendue;
    const bas = Math.min(ouverture, cloture) - etendue;
    const volume = Math.round(1000 + Math.abs(bruit(index, graine ^ 0x27d4eb2f)) * 9000);

    chandeliers.push({
      horodatage,
      ouverture: arrondir(ouverture),
      haut: arrondir(haut),
      bas: arrondir(bas),
      cloture: arrondir(cloture),
      volume,
    });
  }

  return chandeliers;
}
