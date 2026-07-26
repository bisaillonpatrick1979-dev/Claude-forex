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
 * Twelve Data — fournisseur multi-actifs de référence.
 *
 * Palier gratuit : ~800 requêtes/jour, actions + forex + crypto + ETF, données
 * retardées. C'est le plus généreux des acteurs établis, donc le primaire par
 * défaut sur la plupart des classes d'actifs.
 *
 * Deux pièges de son API :
 *   - un HTTP 200 peut contenir `{"status":"error"}` — le code HTTP ne suffit
 *     jamais à conclure au succès ;
 *   - `datetime` est rendu dans le fuseau de la place par défaut. On force
 *     `timezone=UTC` pour que la normalisation soit sans ambiguïté.
 */

const RACINE = 'https://api.twelvedata.com/time_series';

const INTERVALLES_TD: Readonly<Record<Intervalle, string>> = {
  M1: '1min',
  M5: '5min',
  M15: '15min',
  M30: '30min',
  H1: '1h',
  H4: '4h',
  D1: '1day',
  W1: '1week',
};

interface ValeurTD {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface ReponseTD {
  status?: string;
  code?: number;
  message?: string;
  values?: readonly ValeurTD[];
}

export class FournisseurTwelveData implements FournisseurDonneesMarche {
  readonly code = 'twelvedata' as const;
  readonly nom = 'Twelve Data';

  capacites(): Capacites {
    return {
      classesActifs: ['FOREX', 'INDICE', 'ACTION', 'CRYPTO', 'MATIERE_PREMIERE'],
      intervalles: Object.keys(INTERVALLES_TD) as Intervalle[],
      necessiteCle: true,
      limiteParAppel: 5000,
    };
  }

  async recupererChandeliers(
    demande: DemandeChandeliers,
    contexte: ContexteAppel,
  ): Promise<ReponseFournisseur> {
    if (!contexte.cle) {
      throw new ErreurFournisseur(this.code, 'AUTHENTIFICATION', 'Clé Twelve Data absente.');
    }

    const url = new URL(RACINE);
    url.searchParams.set('symbol', contexte.symboleExterne);
    url.searchParams.set('interval', INTERVALLES_TD[demande.intervalle]);
    url.searchParams.set('outputsize', String(Math.min(demande.limite, 5000)));
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('format', 'JSON');
    url.searchParams.set('apikey', contexte.cle);

    const corps = await appeler(url, contexte.signal);

    if (!corps.values || corps.values.length === 0) {
      throw new ErreurFournisseur(this.code, 'REPONSE_INVALIDE', 'Série Twelve Data vide.');
    }

    const chandeliers: Chandelier[] = [];
    for (const valeur of corps.values) {
      const chandelier = normaliser(valeur);
      if (chandelier) chandeliers.push(chandelier);
    }

    if (chandeliers.length === 0) {
      throw new ErreurFournisseur(
        this.code,
        'REPONSE_INVALIDE',
        'Aucune bougie exploitable dans la réponse Twelve Data.',
      );
    }

    // Twelve Data rend du plus récent au plus ancien ; tout le système attend
    // l'ordre chronologique croissant.
    chandeliers.sort((a, b) => a.horodatage - b.horodatage);

    return { chandeliers: chandeliers.slice(-demande.limite), retarde: true };
  }

  async tester(contexte: Pick<ContexteAppel, 'cle' | 'signal'>): Promise<ResultatTest> {
    const debut = Date.now();
    if (!contexte.cle) {
      return { ok: false, message: 'Aucune clé enregistrée.', latenceMs: 0 };
    }
    try {
      const url = new URL(RACINE);
      url.searchParams.set('symbol', 'EUR/USD');
      url.searchParams.set('interval', '1day');
      url.searchParams.set('outputsize', '1');
      url.searchParams.set('apikey', contexte.cle);
      await appeler(url, contexte.signal);
      return { ok: true, message: 'Clé valide, série reçue.', latenceMs: Date.now() - debut };
    } catch (erreur) {
      return {
        ok: false,
        message: erreur instanceof Error ? erreur.message : 'Échec inconnu.',
        latenceMs: Date.now() - debut,
      };
    }
  }
}

function normaliser(valeur: ValeurTD): Chandelier | null {
  if (!valeur.datetime) return null;

  // « 2026-07-24 13:30:00 » sans fuseau : c'est de l'UTC puisqu'on l'a demandé.
  const iso = valeur.datetime.includes('T')
    ? valeur.datetime
    : `${valeur.datetime.replace(' ', 'T')}${valeur.datetime.length <= 10 ? 'T00:00:00' : ''}Z`;
  const millisecondes = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(millisecondes)) return null;

  const ouverture = Number.parseFloat(valeur.open ?? '');
  const haut = Number.parseFloat(valeur.high ?? '');
  const bas = Number.parseFloat(valeur.low ?? '');
  const cloture = Number.parseFloat(valeur.close ?? '');
  if (![ouverture, haut, bas, cloture].every(Number.isFinite)) return null;

  const volumeBrut = valeur.volume === undefined ? Number.NaN : Number.parseFloat(valeur.volume);

  return {
    horodatage: Math.floor(millisecondes / 1000),
    ouverture,
    haut,
    bas,
    cloture,
    volume: Number.isFinite(volumeBrut) ? volumeBrut : null,
  };
}

async function appeler(url: URL, signal?: AbortSignal): Promise<ReponseTD> {
  let reponse: Response;
  try {
    reponse = await fetch(url, { signal, cache: 'no-store' });
  } catch (erreur) {
    throw new ErreurFournisseur(
      'twelvedata',
      'RESEAU',
      erreur instanceof Error ? erreur.message : 'Échec réseau.',
    );
  }

  if (reponse.status === 429) {
    throw new ErreurFournisseur('twelvedata', 'QUOTA_EPUISE', 'Quota Twelve Data atteint (429).');
  }
  if (reponse.status === 401 || reponse.status === 403) {
    throw new ErreurFournisseur('twelvedata', 'AUTHENTIFICATION', 'Clé Twelve Data refusée.');
  }

  let corps: ReponseTD;
  try {
    corps = (await reponse.json()) as ReponseTD;
  } catch {
    throw new ErreurFournisseur(
      'twelvedata',
      'REPONSE_INVALIDE',
      'Réponse Twelve Data illisible.',
    );
  }

  // Un 200 peut porter une erreur applicative : c'est le piège principal.
  if (corps.status === 'error') {
    const message = corps.message ?? 'Erreur Twelve Data.';
    if (corps.code === 429) {
      throw new ErreurFournisseur('twelvedata', 'QUOTA_EPUISE', message);
    }
    if (corps.code === 401 || corps.code === 403) {
      throw new ErreurFournisseur('twelvedata', 'AUTHENTIFICATION', message);
    }
    if (corps.code === 404 || corps.code === 400) {
      throw new ErreurFournisseur('twelvedata', 'SYMBOLE_INCONNU', message);
    }
    throw new ErreurFournisseur('twelvedata', 'REPONSE_INVALIDE', message);
  }

  if (!reponse.ok) {
    throw new ErreurFournisseur('twelvedata', 'RESEAU', `Twelve Data a répondu ${reponse.status}.`);
  }

  return corps;
}
