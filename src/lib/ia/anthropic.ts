import Anthropic from '@anthropic-ai/sdk';

import { accepteTemperature, MODELES_PAR_FOURNISSEUR } from './tarifs';
import { ErreurLLM, type AdaptateurLLM, type ContexteAppelLLM, type DemandeLLM, type ReponseLLM } from './types';

/**
 * Adaptateur Anthropic, via le SDK officiel `@anthropic-ai/sdk`.
 *
 * Deux pièges traités ici, tous deux vérifiés contre la documentation à jour
 * plutôt que de mémoire :
 *
 *  1. `temperature` est refusé avec un 400 sur Opus 5, Sonnet 5 et Opus 4.7+.
 *     La colonne `agents.temperature` reste utile pour les autres fournisseurs,
 *     donc c'est `accepteTemperature()` qui décide de la transmettre.
 *  2. `budget_tokens` n'existe plus ; la réflexion étendue se demande avec
 *     `thinking: { type: 'adaptive' }`. On ne l'active pas ici : les réponses
 *     attendues sont courtes et cadrées, et chaque token de réflexion est
 *     facturé en sortie — donc imputé au plafond quotidien de l'utilisateur.
 */

function texte(blocs: Anthropic.Messages.ContentBlock[]): string {
  return blocs
    .filter((bloc): bloc is Anthropic.Messages.TextBlock => bloc.type === 'text')
    .map((bloc) => bloc.text)
    .join('\n')
    .trim();
}

export const adaptateurAnthropic: AdaptateurLLM = {
  code: 'anthropic',
  nom: 'Anthropic (Claude)',
  necessiteCle: true,
  modeles: MODELES_PAR_FOURNISSEUR.anthropic,

  async appeler(demande: DemandeLLM, contexte: ContexteAppelLLM): Promise<ReponseLLM> {
    if (!contexte.cle) {
      throw new ErreurLLM('anthropic', 'Clé API Anthropic absente.');
    }

    const client = new Anthropic({ apiKey: contexte.cle, maxRetries: 1 });
    const debut = Date.now();

    const parametres: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: demande.modele,
      max_tokens: demande.tokensMax,
      system: demande.systeme,
      messages: demande.messages.map((message) => ({
        role: message.role === 'utilisateur' ? ('user' as const) : ('assistant' as const),
        content: message.contenu,
      })),
    };

    if (demande.temperature !== null && accepteTemperature('anthropic', demande.modele)) {
      parametres.temperature = demande.temperature;
    }

    try {
      const reponse = await client.messages.create(parametres, { signal: demande.signal });

      return {
        contenu: texte(reponse.content),
        tokensEntree: reponse.usage.input_tokens,
        tokensSortie: reponse.usage.output_tokens,
        latenceMs: Date.now() - debut,
        modele: reponse.model,
        tronquee: reponse.stop_reason === 'max_tokens',
      };
    } catch (erreur) {
      throw traduire(erreur);
    }
  },
};

/** Traduit les exceptions typées du SDK en une erreur que l'orchestrateur
 *  sait interpréter, sans jamais recopier la clé dans le message. */
function traduire(erreur: unknown): ErreurLLM {
  if (erreur instanceof Anthropic.RateLimitError) {
    return new ErreurLLM('anthropic', 'Limite de débit Anthropic atteinte.', true);
  }
  if (erreur instanceof Anthropic.AuthenticationError) {
    return new ErreurLLM('anthropic', 'Clé API Anthropic refusée.');
  }
  if (erreur instanceof Anthropic.BadRequestError) {
    return new ErreurLLM('anthropic', `Requête refusée par Anthropic : ${erreur.message}`);
  }
  if (erreur instanceof Anthropic.APIConnectionError) {
    return new ErreurLLM('anthropic', 'Connexion à Anthropic impossible.', true);
  }
  if (erreur instanceof Anthropic.InternalServerError) {
    return new ErreurLLM('anthropic', 'Anthropic a répondu par une erreur serveur.', true);
  }
  if (erreur instanceof Anthropic.APIError) {
    return new ErreurLLM('anthropic', `Anthropic : ${erreur.message}`);
  }
  return new ErreurLLM('anthropic', erreur instanceof Error ? erreur.message : 'Erreur inconnue.');
}
