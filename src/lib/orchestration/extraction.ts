import { z } from 'zod';

import { bornesPlausibles, type InstantaneMarche } from './instantane';

/**
 * Lecture des sorties structurées des agents.
 *
 * Un modèle de langage rend du texte, pas un objet. Tout ce qui sort d'ici est
 * validé par un schéma : si la forme n'est pas la bonne, l'étape échoue de
 * façon visible au lieu de propager un `undefined` jusqu'au moteur d'exécution.
 *
 * Le contrôle d'ancrage vit ici aussi : c'est le dernier endroit où un prix
 * inventé peut encore être arrêté avant de devenir un ordre.
 */

/** Extrait le dernier bloc JSON du texte. Le dernier et non le premier : les
 *  modèles ont l'habitude d'illustrer puis de conclure. */
export function extraireJson(texte: string): unknown {
  const blocs = [...texte.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
    .map((correspondance) => correspondance[1]?.trim())
    .filter((bloc): bloc is string => Boolean(bloc));

  const candidats = blocs.length > 0 ? blocs : [decoupeAccolades(texte)].filter(Boolean);

  for (const candidat of candidats.reverse()) {
    try {
      return JSON.parse(candidat as string);
    } catch {
      continue;
    }
  }
  return null;
}

/** Repli quand le modèle n'a pas clôturé son bloc : on prend du premier « { »
 *  au dernier « } ». Approximatif, mais le JSON.parse tranche ensuite. */
function decoupeAccolades(texte: string): string | null {
  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  return debut >= 0 && fin > debut ? texte.slice(debut, fin + 1) : null;
}

export const schemaVueMarche = z.object({
  direction: z.enum(['HAUSSIER', 'BAISSIER', 'NEUTRE']),
  conviction: z.coerce.number().min(0).max(100),
  horizon: z.string().max(60).nullable().optional(),
  niveau_invalidation: z.coerce.number().positive().nullable().optional(),
  resume: z.string().min(1).max(4000),
});

export type VueMarche = z.infer<typeof schemaVueMarche>;

export const schemaProposition = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('ABSTENTION'),
    raisonnement: z.string().min(1).max(4000),
  }),
  z.object({
    action: z.literal('ORDRE'),
    sens: z.enum(['ACHAT', 'VENTE']),
    type_ordre: z.enum(['MARCHE', 'LIMITE', 'STOP']),
    quantite: z.coerce.number().positive().max(500),
    prix_entree: z.coerce.number().positive().nullable().optional(),
    stop_loss: z.coerce.number().positive(),
    take_profit: z.coerce.number().positive().nullable().optional(),
    validite_minutes: z.coerce.number().int().min(1).max(10_080).nullable().optional(),
    raisonnement: z.string().min(1).max(4000),
  }),
]);

export type Proposition = z.infer<typeof schemaProposition>;

export const schemaDecisionPm = z.object({
  decision: z.enum(['APPROUVE', 'REFUSE']),
  justification: z.string().min(1).max(4000),
});

export const schemaLecon = z.object({
  titre: z.string().min(1).max(200),
  contenu: z.string().min(1).max(4000),
  etiquettes: z.array(z.string().max(40)).max(8).default([]),
});

export interface ResultatAnalyse<T> {
  readonly ok: boolean;
  readonly valeur?: T;
  readonly erreur?: string;
}

export function analyser<T>(schema: z.ZodType<T>, texte: string): ResultatAnalyse<T> {
  const brut = extraireJson(texte);
  if (brut === null) {
    return { ok: false, erreur: 'Aucun bloc JSON exploitable dans la réponse.' };
  }

  const resultat = schema.safeParse(brut);
  if (!resultat.success) {
    const details = resultat.error.issues
      .map((probleme) => `${probleme.path.join('.') || 'racine'} : ${probleme.message}`)
      .join(' | ');
    return { ok: false, erreur: `Sortie non conforme — ${details}` };
  }

  return { ok: true, valeur: resultat.data };
}

/**
 * Contrôle d'ancrage des niveaux.
 *
 * Refuse une proposition dont un prix sort largement de l'amplitude observée
 * dans l'instantané, et refuse un stop placé du mauvais côté de l'entrée. Le
 * second cas est aussi traité par les garde-fous ; le doublon est volontaire,
 * il permet de rendre à l'utilisateur un message qui nomme l'agent fautif.
 */
export function verifierAncrage(
  proposition: Extract<Proposition, { action: 'ORDRE' }>,
  instantane: InstantaneMarche,
): { ok: true } | { ok: false; raison: string } {
  const { min, max } = bornesPlausibles(instantane);
  const entree = proposition.prix_entree ?? instantane.dernierPrix;

  const niveaux: readonly (readonly [string, number | null | undefined])[] = [
    ['prix d’entrée', proposition.prix_entree],
    ['stop-loss', proposition.stop_loss],
    ['take-profit', proposition.take_profit],
  ];

  for (const [nom, valeur] of niveaux) {
    if (valeur === null || valeur === undefined) continue;
    if (valeur < min || valeur > max) {
      return {
        ok: false,
        raison: `Niveau hors instantané : ${nom} à ${valeur}, alors que l’instantané évolue entre ${instantane.plusBas} et ${instantane.plusHaut}. Proposition écartée.`,
      };
    }
  }

  const stopAuMauvaisCote =
    proposition.sens === 'ACHAT'
      ? proposition.stop_loss >= entree
      : proposition.stop_loss <= entree;

  if (stopAuMauvaisCote) {
    return {
      ok: false,
      raison: `Stop-loss incohérent : ${proposition.stop_loss} pour un ${proposition.sens} entré à ${entree}.`,
    };
  }

  if (proposition.take_profit !== null && proposition.take_profit !== undefined) {
    const cibleAuMauvaisCote =
      proposition.sens === 'ACHAT'
        ? proposition.take_profit <= entree
        : proposition.take_profit >= entree;
    if (cibleAuMauvaisCote) {
      return {
        ok: false,
        raison: `Take-profit incohérent : ${proposition.take_profit} pour un ${proposition.sens} entré à ${entree}.`,
      };
    }
  }

  return { ok: true };
}
