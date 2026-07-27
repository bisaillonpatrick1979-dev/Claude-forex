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

/**
 * Sources réellement consultées, extraites des blocs de résultat de recherche.
 *
 * On les remonte pour les afficher dans le fil : un agent qui parle de « la
 * décision de la BCE » doit pouvoir être vérifié. Sans le lien, l'affirmation
 * ne vaut pas mieux qu'une hallucination bien tournée.
 */
function sourcesConsultees(
  blocs: Anthropic.Messages.ContentBlock[],
): readonly { titre: string; url: string }[] {
  const vues = new Map<string, string>();

  for (const bloc of blocs) {
    if (bloc.type !== 'web_search_tool_result') continue;
    const contenu = (bloc as { content?: unknown }).content;
    if (!Array.isArray(contenu)) continue;

    for (const resultat of contenu) {
      const url = (resultat as { url?: unknown }).url;
      const titre = (resultat as { title?: unknown }).title;
      if (typeof url === 'string' && !vues.has(url)) {
        vues.set(url, typeof titre === 'string' && titre ? titre : url);
      }
    }
  }

  return [...vues.entries()].map(([url, titre]) => ({ url, titre }));
}

/**
 * Modèles capables des outils web côté serveur.
 *
 * Liste blanche : demander l'outil à un modèle qui ne le connaît pas fait
 * échouer l'appel entier, alors que s'en passer ne fait que dégrader la
 * réponse. On préfère une analyse sans recherche à pas d'analyse du tout.
 */
const MODELES_AVEC_RECHERCHE: readonly string[] = [
  'claude-opus-5',
  'claude-sonnet-5',
];

/** Catégorie du refus quand l'API la précise. Elle vaut d'être affichée : elle
 *  dit s'il faut reformuler ou changer de modèle. */
function categorieRefus(reponse: Anthropic.Messages.Message): string | null {
  const details = (reponse as { stop_details?: { category?: unknown } }).stop_details;
  return typeof details?.category === 'string' ? details.category : null;
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

    // L'effort remplace la température sur les modèles qui la refusent, mais ce
    // n'est pas le même réglage : la température fait varier le style, l'effort
    // fait varier la quantité de raisonnement — donc le coût et la latence.
    // C'est le seul levier de dépense dont on dispose une fois le modèle choisi.
    if (demande.effort) {
      parametres.output_config = { effort: demande.effort };
    }

    if (demande.rechercheWeb && MODELES_AVEC_RECHERCHE.includes(demande.modele)) {
      const restriction =
        demande.domainesAutorises && demande.domainesAutorises.length > 0
          ? { allowed_domains: [...demande.domainesAutorises] }
          : {};

      // `max_uses` borne la dépense : sans plafond, un agent peut enchaîner
      // quinze recherches sur une question qui en méritait deux.
      parametres.tools = [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 5, ...restriction },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, ...restriction },
      ] as Anthropic.Messages.MessageCreateParams['tools'];
    }

    try {
      const reponse = await client.messages.create(parametres, { signal: demande.signal });

      // Un refus des classificateurs de sécurité arrive en HTTP 200 avec un
      // contenu vide. Sans ce contrôle, l'extraction JSON échouerait sur
      // « aucun bloc exploitable » — un message qui envoie déboguer le schéma
      // alors que le modèle a simplement refusé de répondre.
      if (reponse.stop_reason === 'refusal') {
        throw new ErreurLLM(
          'anthropic',
          `Le modèle a refusé de répondre${categorieRefus(reponse) ? ` (${categorieRefus(reponse)})` : ''}. Reformuler la demande, ou confier ce rôle à un autre modèle.`,
        );
      }

      return {
        contenu: texte(reponse.content),
        sources: sourcesConsultees(reponse.content),
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
