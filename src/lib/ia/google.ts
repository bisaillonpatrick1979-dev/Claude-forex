import { MODELES_PAR_FOURNISSEUR } from './tarifs';
import {
  ErreurLLM,
  estimerTokens,
  type AdaptateurLLM,
  type ContexteAppelLLM,
  type DemandeLLM,
  type ReponseLLM,
} from './types';

/**
 * Adaptateur Google Gemini, API « Generative Language » en fetch direct.
 *
 * Deux particularités du format Gemini traitées ici :
 *  - la consigne système n'est pas un message mais un champ à part
 *    (`systemInstruction`) ;
 *  - les rôles s'appellent `user` et `model`, pas `assistant`.
 *
 * La clé voyage en en-tête `x-goog-api-key` et non dans l'URL : une clé en
 * query string finit dans les journaux d'accès de tous les intermédiaires.
 */

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface ReponseGemini {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
    readonly finishReason?: string;
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
  readonly error?: { readonly message?: string };
}

export const adaptateurGoogle: AdaptateurLLM = {
  code: 'google',
  nom: 'Google (Gemini)',
  necessiteCle: true,
  modeles: MODELES_PAR_FOURNISSEUR.google,

  async appeler(demande: DemandeLLM, contexte: ContexteAppelLLM): Promise<ReponseLLM> {
    if (!contexte.cle) throw new ErreurLLM('google', 'Clé API Google absente.');

    const debut = Date.now();
    const generation: Record<string, unknown> = { maxOutputTokens: demande.tokensMax };
    if (demande.temperature !== null) generation.temperature = demande.temperature;

    const corps = {
      systemInstruction: { parts: [{ text: demande.systeme }] },
      contents: demande.messages.map((message) => ({
        role: message.role === 'utilisateur' ? 'user' : 'model',
        parts: [{ text: message.contenu }],
      })),
      generationConfig: generation,
    };

    let reponse: Response;
    try {
      reponse = await fetch(
        `${URL_BASE}/models/${encodeURIComponent(demande.modele)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': contexte.cle },
          body: JSON.stringify(corps),
          signal: demande.signal,
        },
      );
    } catch {
      throw new ErreurLLM('google', 'Connexion à Google impossible.', true);
    }

    const donnees = (await reponse.json().catch(() => null)) as ReponseGemini | null;

    if (!reponse.ok || !donnees || donnees.error) {
      const detail = donnees?.error?.message ?? `HTTP ${reponse.status}`;
      throw new ErreurLLM(
        'google',
        `Google : ${detail}`,
        reponse.status === 429 || reponse.status >= 500,
      );
    }

    const candidat = donnees.candidates?.[0];
    const contenu = (candidat?.content?.parts ?? [])
      .map((partie) => partie.text ?? '')
      .join('\n')
      .trim();

    if (!contenu) {
      // Gemini répond 200 avec un candidat vide quand un filtre de sécurité a
      // bloqué la génération : le silence serait pris pour une réponse valide.
      throw new ErreurLLM(
        'google',
        `Google a renvoyé une réponse vide (motif : ${candidat?.finishReason ?? 'inconnu'}).`,
      );
    }

    return {
      contenu,
      tokensEntree: donnees.usageMetadata?.promptTokenCount ?? estimerTokens(demande.systeme),
      tokensSortie: donnees.usageMetadata?.candidatesTokenCount ?? estimerTokens(contenu),
      latenceMs: Date.now() - debut,
      modele: demande.modele,
      tronquee: candidat?.finishReason === 'MAX_TOKENS',
    };
  },
};
