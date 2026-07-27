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
 * Finnhub — actions américaines et crypto.
 *
 * Palier gratuit : 60 requêtes/minute, ce qui est confortable, mais **le Forex
 * et les chandeliers d'indices y sont réservés aux formules payantes**. On ne
 * déclare donc que ce qui fonctionne réellement sans abonnement : annoncer une
 * classe d'actifs qu'il refusera produit un incident à chaque appel, et le
 * routeur perdrait du temps à l'essayer avant de basculer.
 *
 * Deux pièges de son API :
 *   - la réponse porte un champ `s` valant `"ok"` ou `"no_data"` ; un HTTP 200
 *     avec `"no_data"` n'est pas un succès ;
 *   - les séries arrivent en colonnes parallèles (`t`, `o`, `h`, `l`, `c`,
 *     `v`) et non en objets. Un tableau plus court que les autres signale une
 *     réponse tronquée : on s'arrête au plus petit plutôt que de produire des
 *     `undefined` déguisés en prix.
 */

const RACINE = 'https://finnhub.io/api/v1/stock/candle';

const RESOLUTIONS: Readonly<Record<Intervalle, string>> = {
  M1: '1',
  M5: '5',
  M15: '15',
  M30: '30',
  H1: '60',
  H4: '240',
  D1: 'D',
  W1: 'W',
};

const SECONDES_PAR_INTERVALLE: Readonly<Record<Intervalle, number>> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1_800,
  H1: 3_600,
  H4: 14_400,
  D1: 86_400,
  W1: 604_800,
};

interface ReponseFinnhub {
  s?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
  error?: string;
}

export class FournisseurFinnhub implements FournisseurDonneesMarche {
  readonly code = 'finnhub' as const;
  readonly nom = 'Finnhub';

  capacites(): Capacites {
    return {
      // Ni FOREX ni INDICE : le palier gratuit les refuse. Les déclarer ferait
      // échouer un appel sur deux avant que le routeur ne bascule.
      classesActifs: ['ACTION', 'CRYPTO'],
      intervalles: ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'],
      necessiteCle: true,
      limiteParAppel: 500,
      // Le palier gratuit de Finnhub a retiré l'accès aux bougies datées.
      fenetreHistorique: false,
    };
  }

  async recupererChandeliers(
    demande: DemandeChandeliers,
    contexte: ContexteAppel,
  ): Promise<ReponseFournisseur> {
    if (!contexte.cle) {
      throw new ErreurFournisseur('finnhub', 'AUTHENTIFICATION', 'Clé API absente.');
    }

    const duree = SECONDES_PAR_INTERVALLE[demande.intervalle];
    const jusqua = Math.floor(Date.now() / 1000);
    // Marge de sécurité : les jours fériés et les week-ends ne rendent aucune
    // bougie, donc demander exactement `limite` périodes en rendrait moins.
    const depuis = jusqua - duree * demande.limite * 3;

    const url = new URL(RACINE);
    url.searchParams.set('symbol', contexte.symboleExterne);
    url.searchParams.set('resolution', RESOLUTIONS[demande.intervalle]);
    url.searchParams.set('from', String(depuis));
    url.searchParams.set('to', String(jusqua));
    url.searchParams.set('token', contexte.cle);

    let reponse: Response;
    try {
      reponse = await fetch(url, { signal: contexte.signal, cache: 'no-store' });
    } catch {
      throw new ErreurFournisseur('finnhub', 'RESEAU', 'Connexion impossible.');
    }

    if (reponse.status === 401 || reponse.status === 403) {
      throw new ErreurFournisseur('finnhub', 'AUTHENTIFICATION', 'Clé refusée ou ressource réservée au palier payant.');
    }
    if (reponse.status === 429) {
      throw new ErreurFournisseur('finnhub', 'QUOTA_EPUISE', 'Limite de débit atteinte.');
    }
    if (!reponse.ok) {
      throw new ErreurFournisseur('finnhub', 'REPONSE_INVALIDE', `HTTP ${reponse.status}.`);
    }

    const donnees = (await reponse.json().catch(() => null)) as ReponseFinnhub | null;
    if (!donnees) throw new ErreurFournisseur('finnhub', 'REPONSE_INVALIDE', 'Réponse illisible.');
    if (donnees.error) throw new ErreurFournisseur('finnhub', 'REPONSE_INVALIDE', donnees.error);

    if (donnees.s === 'no_data') {
      throw new ErreurFournisseur('finnhub', 'SYMBOLE_INCONNU', 'Aucune donnée pour ce symbole et cette période.');
    }
    if (donnees.s !== 'ok') {
      throw new ErreurFournisseur('finnhub', 'REPONSE_INVALIDE', `Statut inattendu : ${donnees.s ?? 'absent'}.`);
    }

    const chandeliers = assembler(donnees);
    if (chandeliers.length === 0) {
      throw new ErreurFournisseur('finnhub', 'REPONSE_INVALIDE', 'Série vide après normalisation.');
    }

    return { chandeliers: chandeliers.slice(-demande.limite), retarde: true };
  }

  async tester(contexte: Pick<ContexteAppel, 'cle' | 'signal'>): Promise<ResultatTest> {
    const debut = Date.now();
    if (!contexte.cle) {
      return { ok: false, message: 'Clé API absente.', latenceMs: 0 };
    }

    try {
      await this.recupererChandeliers(
        { symbole: 'AAPL', classeActif: 'ACTION', intervalle: 'D1', limite: 5 },
        { cle: contexte.cle, symboleExterne: 'AAPL', signal: contexte.signal },
      );
      return { ok: true, message: 'Connexion établie.', latenceMs: Date.now() - debut };
    } catch (erreur) {
      return {
        ok: false,
        message: erreur instanceof Error ? erreur.message : 'Échec inconnu.',
        latenceMs: Date.now() - debut,
      };
    }
  }
}

/**
 * Recolle les colonnes parallèles en chandeliers.
 *
 * On s'arrête au plus court des tableaux : une réponse tronquée produirait
 * sinon des `undefined` convertis en `NaN`, c'est-à-dire des prix inventés.
 */
function assembler(donnees: ReponseFinnhub): Chandelier[] {
  const { t = [], o = [], h = [], l = [], c = [] } = donnees;
  const volumes = donnees.v;
  const taille = Math.min(t.length, o.length, h.length, l.length, c.length);

  const chandeliers: Chandelier[] = [];
  for (let index = 0; index < taille; index += 1) {
    const horodatage = t[index];
    const ouverture = o[index];
    const haut = h[index];
    const bas = l[index];
    const cloture = c[index];

    if (
      horodatage === undefined ||
      !Number.isFinite(ouverture) ||
      !Number.isFinite(haut) ||
      !Number.isFinite(bas) ||
      !Number.isFinite(cloture)
    ) {
      continue;
    }

    chandeliers.push({
      horodatage,
      ouverture: ouverture as number,
      haut: haut as number,
      bas: bas as number,
      cloture: cloture as number,
      // `null` et non `0` : « pas de volume » n'est pas « volume nul ».
      volume: volumes && Number.isFinite(volumes[index]) ? (volumes[index] as number) : null,
    });
  }

  return chandeliers.sort((a, b) => a.horodatage - b.horodatage);
}
