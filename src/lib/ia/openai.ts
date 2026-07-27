import { MODELES_PAR_FOURNISSEUR } from './tarifs';
import {
  ErreurLLM,
  estimerTokens,
  type AdaptateurLLM,
  type ContexteAppelLLM,
  type DemandeLLM,
  type FournisseurLLM,
  type ReponseLLM,
} from './types';

/**
 * Adaptateur OpenAI, en `fetch` direct sur /v1/chat/completions.
 *
 * Pas de SDK ici : une seule route est utilisée, la charge utile tient en dix
 * lignes, et une dépendance de plus sur le palier gratuit de Vercel coûte du
 * temps de démarrage à froid pour rien. Le jour où l'on aura besoin du
 * streaming ou des outils côté OpenAI, ce fichier sera remplacé par le SDK.
 */

/**
 * DeepSeek et Mistral exposent la même API que /v1/chat/completions : mêmes
 * routes, mêmes champs, mêmes compteurs de tokens. On partage donc
 * l'implémentation au lieu d'écrire deux fichiers quasi identiques qui
 * dériveraient l'un de l'autre au premier correctif.
 *
 * Ce qui diffère — l'URL de base, le nom affiché, la grille tarifaire — est
 * paramétré ; le reste est commun.
 */
const URL_BASE = 'https://api.openai.com/v1';

interface ReponseChat {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
    readonly finish_reason?: string;
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
  readonly error?: { readonly message?: string };
  readonly model?: string;
}

function adaptateurCompatibleOpenAI(config: {
  code: FournisseurLLM;
  nom: string;
  urlBase: string;
}): AdaptateurLLM {
  return {
  code: config.code,
  nom: config.nom,
  necessiteCle: true,
  modeles: MODELES_PAR_FOURNISSEUR[config.code],

  async appeler(demande: DemandeLLM, contexte: ContexteAppelLLM): Promise<ReponseLLM> {
    if (!contexte.cle) throw new ErreurLLM(config.code, `Clé API ${config.nom} absente.`);

    const debut = Date.now();
    const corps: Record<string, unknown> = {
      model: demande.modele,
      max_completion_tokens: demande.tokensMax,
      messages: [
        { role: 'system', content: demande.systeme },
        ...demande.messages.map((message) => ({
          role: message.role === 'utilisateur' ? 'user' : 'assistant',
          content: message.contenu,
        })),
      ],
    };

    // Les modèles de raisonnement OpenAI refusent une température autre que 1 ;
    // on ne l'envoie que si elle a été explicitement demandée.
    if (demande.temperature !== null) corps.temperature = demande.temperature;

    let reponse: Response;
    try {
      reponse = await fetch(`${config.urlBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${contexte.cle}`,
        },
        body: JSON.stringify(corps),
        signal: demande.signal,
      });
    } catch {
      throw new ErreurLLM(config.code, `Connexion à ${config.nom} impossible.`, true);
    }

    const donnees = (await reponse.json().catch(() => null)) as ReponseChat | null;

    if (!reponse.ok || !donnees || donnees.error) {
      const detail = donnees?.error?.message ?? `HTTP ${reponse.status}`;
      throw new ErreurLLM(
        config.code,
        `${config.nom} : ${detail}`,
        reponse.status === 429 || reponse.status >= 500,
      );
    }

    const choix = donnees.choices?.[0];
    const contenu = (choix?.message?.content ?? '').trim();
    if (!contenu) throw new ErreurLLM(config.code, `${config.nom} a renvoyé une réponse vide.`);

    return {
      contenu,
      tokensEntree: donnees.usage?.prompt_tokens ?? estimerTokens(demande.systeme),
      tokensSortie: donnees.usage?.completion_tokens ?? estimerTokens(contenu),
      latenceMs: Date.now() - debut,
      modele: donnees.model ?? demande.modele,
      tronquee: choix?.finish_reason === 'length',
    };
  },
  };
}

export const adaptateurOpenAI = adaptateurCompatibleOpenAI({
  code: 'openai',
  nom: 'OpenAI (GPT)',
  urlBase: URL_BASE,
});

export const adaptateurDeepSeek = adaptateurCompatibleOpenAI({
  code: 'deepseek',
  nom: 'DeepSeek',
  urlBase: 'https://api.deepseek.com/v1',
});

export const adaptateurMistral = adaptateurCompatibleOpenAI({
  code: 'mistral',
  nom: 'Mistral',
  urlBase: 'https://api.mistral.ai/v1',
});

/** Embeddings OpenAI. Isolé de l'adaptateur de conversation : ce n'est ni le
 *  même endpoint, ni la même unité de facturation. */
export async function embeddingOpenAI(
  cle: string,
  texte: string,
  modele = 'text-embedding-3-small',
  signal?: AbortSignal,
): Promise<{ vecteur: readonly number[]; tokens: number }> {
  const reponse = await fetch(`${URL_BASE}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` },
    body: JSON.stringify({ model: modele, input: texte }),
    signal,
  }).catch(() => null);

  if (!reponse || !reponse.ok) {
    throw new ErreurLLM('openai', 'Calcul d’embedding OpenAI impossible.', true);
  }

  const donnees = (await reponse.json()) as {
    data?: readonly { embedding?: readonly number[] }[];
    usage?: { total_tokens?: number };
  };

  const vecteur = donnees.data?.[0]?.embedding;
  if (!vecteur || vecteur.length === 0) {
    throw new ErreurLLM('openai', 'Embedding OpenAI vide.');
  }

  return { vecteur, tokens: donnees.usage?.total_tokens ?? estimerTokens(texte) };
}
