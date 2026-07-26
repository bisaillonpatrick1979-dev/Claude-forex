import { ErreurFournisseur } from '../erreurs';
import type {
  Capacites,
  Chandelier,
  ContexteAppel,
  DemandeChandeliers,
  FournisseurDonneesMarche,
  Intervalle,
  ReponseFournisseur,
  ResultatTest,
} from '../types';

/**
 * Yahoo Finance — endpoints non officiels.
 *
 * Il n'existe aucune API publique Yahoo : ce sont les points d'entrée du site
 * (query1.finance.yahoo.com), ceux que yfinance rétro-ingénierie. Ils changent
 * sans préavis et renvoient des 429 sous charge.
 *
 * Conséquences assumées dans le code :
 *   - jamais en priorité 1 pour une classe d'actifs critique ;
 *   - un en-tête User-Agent de navigateur, sans quoi Yahoo répond 403 ;
 *   - toute anomalie de forme lève REPONSE_INVALIDE plutôt que de deviner :
 *     un fournisseur qui change de schéma doit faire basculer sur le repli,
 *     pas produire des bougies fausses.
 */

const RACINE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Yahoo n'a pas de 4 heures — d'où l'absence de H4 dans les capacités. */
const INTERVALLES_YAHOO: Readonly<Partial<Record<Intervalle, string>>> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '60m',
  D1: '1d',
  W1: '1wk',
};

/** Yahoo raisonne en plage, pas en nombre de bougies : on prend le plus petit
 *  intervalle de plage qui couvre la demande, et on tronque ensuite. */
function plagePour(intervalle: Intervalle, limite: number): string {
  const jours: Partial<Record<Intervalle, number>> = {
    M1: limite / 1440,
    M5: limite / 288,
    M15: limite / 96,
    M30: limite / 48,
    H1: limite / 24,
    D1: limite,
    W1: limite * 7,
  };
  const requis = Math.ceil(jours[intervalle] ?? limite);
  const paliers: readonly { jours: number; code: string }[] = [
    { jours: 1, code: '1d' },
    { jours: 5, code: '5d' },
    { jours: 30, code: '1mo' },
    { jours: 90, code: '3mo' },
    { jours: 180, code: '6mo' },
    { jours: 365, code: '1y' },
    { jours: 730, code: '2y' },
    { jours: 1825, code: '5y' },
  ];
  return paliers.find((palier) => palier.jours >= requis)?.code ?? 'max';
}

interface ReponseYahoo {
  chart?: {
    error?: { code?: string; description?: string } | null;
    result?: readonly {
      timestamp?: readonly number[];
      indicators?: {
        quote?: readonly {
          open?: readonly (number | null)[];
          high?: readonly (number | null)[];
          low?: readonly (number | null)[];
          close?: readonly (number | null)[];
          volume?: readonly (number | null)[];
        }[];
      };
    }[];
  };
}

export class FournisseurYahoo implements FournisseurDonneesMarche {
  readonly code = 'yahoo' as const;
  readonly nom = 'Yahoo Finance (non officiel)';

  capacites(): Capacites {
    return {
      classesActifs: ['FOREX', 'INDICE', 'ACTION', 'CRYPTO', 'MATIERE_PREMIERE'],
      intervalles: Object.keys(INTERVALLES_YAHOO) as Intervalle[],
      necessiteCle: false,
      limiteParAppel: 2000,
    };
  }

  async recupererChandeliers(
    demande: DemandeChandeliers,
    contexte: ContexteAppel,
  ): Promise<ReponseFournisseur> {
    const intervalleYahoo = INTERVALLES_YAHOO[demande.intervalle];
    if (!intervalleYahoo) {
      throw new ErreurFournisseur(
        this.code,
        'INCAPACITE',
        `Yahoo ne publie pas l'intervalle ${demande.intervalle}.`,
      );
    }

    const url = new URL(`${RACINE}/${encodeURIComponent(contexte.symboleExterne)}`);
    url.searchParams.set('interval', intervalleYahoo);
    url.searchParams.set('range', plagePour(demande.intervalle, demande.limite));

    const reponse = await appeler(url, contexte.signal);
    const corps = (await lireJson(reponse, this.code)) as ReponseYahoo;

    const resultat = corps.chart?.result?.[0];
    if (corps.chart?.error || !resultat) {
      throw new ErreurFournisseur(
        this.code,
        'SYMBOLE_INCONNU',
        corps.chart?.error?.description ?? `Aucune série pour ${contexte.symboleExterne}.`,
      );
    }

    const horodatages = resultat.timestamp;
    const cotations = resultat.indicators?.quote?.[0];
    if (!horodatages || !cotations) {
      throw new ErreurFournisseur(this.code, 'REPONSE_INVALIDE', 'Série Yahoo sans cotations.');
    }

    const chandeliers: Chandelier[] = [];
    for (let i = 0; i < horodatages.length; i += 1) {
      const horodatage = horodatages[i];
      const ouverture = cotations.open?.[i];
      const haut = cotations.high?.[i];
      const bas = cotations.low?.[i];
      const cloture = cotations.close?.[i];

      // Yahoo insère des trous (null) sur les périodes sans échange. On les
      // saute au lieu de les combler : une bougie inventée est pire qu'absente.
      if (
        horodatage === undefined ||
        ouverture == null ||
        haut == null ||
        bas == null ||
        cloture == null
      ) {
        continue;
      }

      const volume = cotations.volume?.[i];
      chandeliers.push({
        horodatage,
        ouverture,
        haut,
        bas,
        cloture,
        volume: volume == null ? null : volume,
      });
    }

    if (chandeliers.length === 0) {
      throw new ErreurFournisseur(this.code, 'REPONSE_INVALIDE', 'Série Yahoo vide.');
    }

    return { chandeliers: chandeliers.slice(-demande.limite), retarde: true };
  }

  async tester(contexte: Pick<ContexteAppel, 'signal'>): Promise<ResultatTest> {
    const debut = Date.now();
    try {
      const url = new URL(`${RACINE}/EURUSD%3DX`);
      url.searchParams.set('interval', '1d');
      url.searchParams.set('range', '5d');
      await appeler(url, contexte.signal);
      return { ok: true, message: 'Endpoint joignable.', latenceMs: Date.now() - debut };
    } catch (erreur) {
      return {
        ok: false,
        message: erreur instanceof Error ? erreur.message : 'Échec inconnu.',
        latenceMs: Date.now() - debut,
      };
    }
  }
}

/** Yahoo refuse les requêtes sans User-Agent de navigateur (403). */
async function appeler(url: URL, signal?: AbortSignal): Promise<Response> {
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (erreur) {
    throw new ErreurFournisseur(
      'yahoo',
      'RESEAU',
      erreur instanceof Error ? erreur.message : 'Échec réseau.',
    );
  }

  if (reponse.status === 429) {
    throw new ErreurFournisseur('yahoo', 'QUOTA_EPUISE', 'Yahoo a renvoyé 429 (trop de requêtes).');
  }
  if (reponse.status === 404) {
    throw new ErreurFournisseur('yahoo', 'SYMBOLE_INCONNU', 'Symbole inconnu chez Yahoo.');
  }
  if (!reponse.ok) {
    throw new ErreurFournisseur('yahoo', 'RESEAU', `Yahoo a répondu ${reponse.status}.`);
  }
  return reponse;
}

async function lireJson(reponse: Response, code: 'yahoo'): Promise<unknown> {
  try {
    return await reponse.json();
  } catch {
    throw new ErreurFournisseur(code, 'REPONSE_INVALIDE', 'Réponse Yahoo illisible.');
  }
}
