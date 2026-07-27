import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

import type { SourcesMarqueurs } from './marqueurs';

type Client = SupabaseClient<Database>;

/**
 * Chargement des décisions à poser sur le graphique.
 *
 * Volontairement borné : les cent dernières de chaque type, tous symboles
 * confondus. Le filtrage par symbole a lieu côté navigateur, parce que le
 * symbole affiché est un état d'interface — recharger la page à chaque
 * changement d'instrument pour trois marqueurs serait absurde.
 *
 * Passe par le client authentifié : RLS suffit ici, tout est en lecture et
 * limité au profil.
 */

const LIMITE = 100;

function versSecondes(valeur: string | null): number {
  return valeur === null ? 0 : Math.floor(new Date(valeur).getTime() / 1000);
}

export async function chargerSourcesMarqueurs(
  client: Client,
  profilId: string,
): Promise<SourcesMarqueurs> {
  const [{ data: positions }, { data: propositions }] = await Promise.all([
    client
      .from('positions')
      .select(
        'id, sens, quantite, prix_entree, prix_sortie, pnl_realise, motif_sortie, ouvert_le, ferme_le, statut, origine, symboles(code)',
      )
      .eq('profil_id', profilId)
      .order('ouvert_le', { ascending: false })
      .limit(LIMITE),
    client
      .from('propositions_ordres')
      .select('id, sens, quantite, statut, raisonnement, cree_le, symboles(code)')
      .eq('profil_id', profilId)
      .in('statut', ['REJETEE_RISQUE', 'REFUSEE_PERMISSION', 'REFUSEE_UTILISATEUR', 'EXPIREE'])
      .order('cree_le', { ascending: false })
      .limit(LIMITE),
  ]);

  const entrees = (positions ?? []).map((ligne) => ({
    id: ligne.id,
    symbole: ligne.symboles?.code ?? '',
    sens: ligne.sens,
    quantite: Number(ligne.quantite),
    prixEntree: Number(ligne.prix_entree),
    ouvertLe: versSecondes(ligne.ouvert_le),
    origine: ligne.origine,
    raisonnement: null,
  }));

  const sorties = (positions ?? [])
    .filter((ligne) => ligne.statut !== 'OUVERTE' && ligne.ferme_le !== null)
    .map((ligne) => ({
      id: ligne.id,
      symbole: ligne.symboles?.code ?? '',
      sens: ligne.sens,
      prixSortie: Number(ligne.prix_sortie ?? 0),
      pnl: ligne.pnl_realise === null ? null : Number(ligne.pnl_realise),
      motif: ligne.motif_sortie,
      fermeLe: versSecondes(ligne.ferme_le),
      origine: ligne.origine,
    }));

  const refus = (propositions ?? []).map((ligne) => ({
    id: ligne.id,
    symbole: ligne.symboles?.code ?? '',
    sens: ligne.sens,
    quantite: Number(ligne.quantite),
    horodatage: versSecondes(ligne.cree_le),
    statut: ligne.statut,
    raison: ligne.raisonnement,
  }));

  return { entrees, sorties, refus };
}
