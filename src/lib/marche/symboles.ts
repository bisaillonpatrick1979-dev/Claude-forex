import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import type { ClasseActif, CodeFournisseur } from './types';

type Client = SupabaseClient<Database>;

export interface Symbole {
  readonly id: string;
  readonly code: string;
  readonly libelle: string;
  readonly classeActif: ClasseActif;
  readonly decimales: number;
  /** Symbole externe par fournisseur. Absent = fournisseur incapable. */
  readonly correspondances: Readonly<Partial<Record<CodeFournisseur, string>>>;
}

/**
 * Résolution d'un symbole interne vers ses équivalents fournisseurs.
 *
 * Aucun adaptateur ne devine un symbole externe : si la correspondance n'est
 * pas en base, le fournisseur est écarté. Deviner « EURUSD » → « EUR/USD »
 * marche pour le Forex et casse dès qu'on touche aux indices (NAS100 vaut
 * « ^NDX » chez Yahoo et « NDX » chez Twelve Data).
 */
export async function chargerSymbole(client: Client, code: string): Promise<Symbole | null> {
  const { data } = await client
    .from('symboles')
    .select('id, code, libelle, classe_actif, decimales, correspondances_symboles(fournisseur_code, symbole_externe)')
    .eq('code', code)
    .eq('actif', true)
    .maybeSingle();

  if (!data) return null;

  const correspondances: Partial<Record<CodeFournisseur, string>> = {};
  for (const ligne of data.correspondances_symboles) {
    correspondances[ligne.fournisseur_code as CodeFournisseur] = ligne.symbole_externe;
  }

  return {
    id: data.id,
    code: data.code,
    libelle: data.libelle,
    classeActif: data.classe_actif,
    decimales: data.decimales,
    correspondances,
  };
}

export interface SymboleListe {
  readonly code: string;
  readonly libelle: string;
  readonly classeActif: ClasseActif;
  readonly decimales: number;
}

export async function listerSymboles(client: Client): Promise<readonly SymboleListe[]> {
  const { data } = await client
    .from('symboles')
    .select('code, libelle, classe_actif, decimales')
    .eq('actif', true)
    .order('classe_actif')
    .order('code');

  return (data ?? []).map((ligne) => ({
    code: ligne.code,
    libelle: ligne.libelle,
    classeActif: ligne.classe_actif,
    decimales: ligne.decimales,
  }));
}
