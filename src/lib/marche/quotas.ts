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
}

export function etatDepuisLigne(ligne: LigneFournisseur, maintenant: Date): EtatQuota {
  const expire = quotaExpire(ligne.fenetre_quota, ligne.quota_reinitialise_le, maintenant);
  const utilise = expire ? 0 : ligne.quota_utilise;
  return {
    code: ligne.code as CodeFournisseur,
    limite: ligne.quota_limite,
    utilise,
    fenetre: ligne.fenetre_quota,
    reinitialiseLe: ligne.quota_reinitialise_le,
    epuise: ligne.quota_limite !== null && utilise >= ligne.quota_limite,
  };
}

/**
 * Incrémente le compteur après un appel réellement émis. Réinitialise d'abord
 * si la fenêtre a basculé.
 *
 * Non atomique : deux appels concurrents peuvent en compter un seul. C'est
 * accepté — le compteur sert à ne pas foncer dans le mur d'un quota, pas à
 * facturer. Une fonction PostgreSQL atomique viendra si la dérive se voit.
 */
export async function consommerQuota(
  client: Client,
  profilId: string,
  code: CodeFournisseur,
  maintenant: Date = new Date(),
): Promise<void> {
  const { data } = await client
    .from('fournisseurs_donnees')
    .select('code, quota_limite, quota_utilise, fenetre_quota, quota_reinitialise_le')
    .eq('profil_id', profilId)
    .eq('code', code)
    .maybeSingle();

  if (!data) return;

  const expire = quotaExpire(data.fenetre_quota, data.quota_reinitialise_le, maintenant);

  await client
    .from('fournisseurs_donnees')
    .update({
      quota_utilise: expire ? 1 : data.quota_utilise + 1,
      quota_reinitialise_le: expire
        ? debutFenetre(data.fenetre_quota, maintenant).toISOString()
        : data.quota_reinitialise_le,
      derniere_verification_le: maintenant.toISOString(),
    })
    .eq('profil_id', profilId)
    .eq('code', code);
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
