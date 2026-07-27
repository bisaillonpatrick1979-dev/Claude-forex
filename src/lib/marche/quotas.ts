import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import type { CodeFournisseur } from './types';

type Client = SupabaseClient<Database>;
type FenetreQuota = Database['public']['Enums']['fenetre_quota'];

/**
 * Compteur de quota persisté par fournisseur et par profil.
 *
 * Persisté et non en mémoire : sur Vercel chaque requête peut atterrir sur une
 * instance différente, un compteur local ne verrait qu'une fraction des appels
 * et laisserait le quota réel s'épuiser sans jamais le signaler.
 */

export interface EtatQuota {
  readonly code: CodeFournisseur;
  readonly limite: number | null;
  readonly utilise: number;
  readonly fenetre: FenetreQuota;
  readonly reinitialiseLe: string;
  readonly epuise: boolean;
  /** Limite de débit, indépendante de la fenêtre principale. */
  readonly limiteParMinute: number | null;
  readonly utiliseCetteMinute: number;
}

const DUREES_FENETRE_MS: Readonly<Record<FenetreQuota, number>> = {
  MINUTE: 60_000,
  HEURE: 3_600_000,
  JOUR: 86_400_000,
  MOIS: 2_592_000_000,
};

/** Début de la fenêtre courante, aligné sur des bornes naturelles (minute
 *  pleine, heure pleine, minuit UTC, premier du mois) plutôt que sur la date
 *  de première utilisation : c'est ainsi que les fournisseurs comptent. */
export function debutFenetre(fenetre: FenetreQuota, maintenant: Date): Date {
  const d = new Date(maintenant.getTime());
  switch (fenetre) {
    case 'MINUTE':
      d.setUTCSeconds(0, 0);
      return d;
    case 'HEURE':
      d.setUTCMinutes(0, 0, 0);
      return d;
    case 'JOUR':
      d.setUTCHours(0, 0, 0, 0);
      return d;
    case 'MOIS':
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d;
  }
}

export function quotaExpire(
  fenetre: FenetreQuota,
  reinitialiseLe: string,
  maintenant: Date,
): boolean {
  const borne = debutFenetre(fenetre, maintenant);
  return new Date(reinitialiseLe).getTime() < borne.getTime();
}

export function dureeFenetreMs(fenetre: FenetreQuota): number {
  return DUREES_FENETRE_MS[fenetre];
}

interface LigneFournisseur {
  code: string;
  quota_limite: number | null;
  quota_utilise: number;
  fenetre_quota: FenetreQuota;
  quota_reinitialise_le: string;
  quota_minute_limite?: number | null;
  quota_minute_utilise?: number | null;
  quota_minute_reinitialise_le?: string | null;
}

export function etatDepuisLigne(ligne: LigneFournisseur, maintenant: Date): EtatQuota {
  const expire = quotaExpire(ligne.fenetre_quota, ligne.quota_reinitialise_le, maintenant);
  const utilise = expire ? 0 : ligne.quota_utilise;

  // La fenêtre minute est indépendante de la principale : un fournisseur peut
  // être à 12/800 sur la journée et déjà refusé sur la minute en cours. C'est
  // exactement ce qui s'est produit, et le modèle à une seule fenêtre ne
  // pouvait pas l'exprimer.
  const limiteParMinute = ligne.quota_minute_limite ?? null;
  const minuteExpiree =
    ligne.quota_minute_reinitialise_le === null ||
    ligne.quota_minute_reinitialise_le === undefined ||
    quotaExpire('MINUTE', ligne.quota_minute_reinitialise_le, maintenant);
  const utiliseCetteMinute = minuteExpiree ? 0 : (ligne.quota_minute_utilise ?? 0);

  return {
    code: ligne.code as CodeFournisseur,
    limite: ligne.quota_limite,
    utilise,
    fenetre: ligne.fenetre_quota,
    reinitialiseLe: ligne.quota_reinitialise_le,
    epuise:
      (ligne.quota_limite !== null && utilise >= ligne.quota_limite) ||
      (limiteParMinute !== null && utiliseCetteMinute >= limiteParMinute),
    limiteParMinute,
    utiliseCetteMinute,
  };
}

export interface Reservation {
  readonly autorise: boolean;
  readonly raison: string | null;
  /** Instant à partir duquel un nouvel appel passera. Null si inconnu. */
  readonly repriseLe: Date | null;
}

/**
 * Réserve un appel avant de l'émettre.
 *
 * Deux changements par rapport au comptage d'origine, tous deux imposés par la
 * réalité observée.
 *
 * **Avant plutôt qu'après.** Un appel refusé par le fournisseur compte quand
 * même dans sa limite de débit. Compter après le succès laissait chaque échec
 * ouvrir la porte au suivant : la rafale qui a déclenché le 429 se poursuivait
 * en s'aggravant.
 *
 * **Atomique plutôt qu'approximatif.** L'ancienne version lisait puis écrivait
 * en deux requêtes et l'assumait. La dérive est anodine sur huit cents appels
 * par jour et fatale sur huit par minute : deux instances servant la même
 * rafale suffisent à dépasser sans jamais le voir. Le verrou vit maintenant
 * dans PostgreSQL, seul endroit que toutes les instances partagent.
 *
 * Exige le client à privilèges : la fonction n'est accordée qu'à service_role.
 */
export async function reserverAppel(
  client: Client,
  profilId: string,
  code: CodeFournisseur,
  maintenant: Date = new Date(),
): Promise<Reservation> {
  const { data, error } = await client.rpc('reserver_appel_fournisseur', {
    p_profil_id: profilId,
    p_code: code,
    p_maintenant: maintenant.toISOString(),
  });

  if (error) {
    // Refuser plutôt que laisser passer : une réservation qu'on ne sait pas
    // enregistrer est exactement le cas où l'on risque de dépasser sans le voir.
    return { autorise: false, raison: `Réservation impossible : ${error.message}`, repriseLe: null };
  }

  const ligne = Array.isArray(data) ? data[0] : data;
  if (!ligne) {
    return { autorise: false, raison: 'Réservation sans réponse.', repriseLe: null };
  }

  return {
    autorise: ligne.autorise,
    raison: ligne.raison,
    repriseLe: ligne.reprise_le ? new Date(ligne.reprise_le) : null,
  };
}

export async function journaliserResultatFournisseur(
  client: Client,
  profilId: string,
  code: CodeFournisseur,
  statut: string,
  erreur: string | null,
): Promise<void> {
  await client
    .from('fournisseurs_donnees')
    .update({
      dernier_statut: statut,
      derniere_erreur: erreur,
      derniere_verification_le: new Date().toISOString(),
    })
    .eq('profil_id', profilId)
    .eq('code', code);
}
