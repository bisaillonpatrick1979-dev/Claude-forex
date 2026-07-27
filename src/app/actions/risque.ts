'use server';

import { revalidatePath } from 'next/cache';

import {
  CHAMPS_LIMITES,
  repartirParTable,
  validerLimites,
  type CleLimite,
  type ValeursLimites,
} from '@/lib/config/limites';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Édition des limites depuis l'application.
 *
 * L'écriture passe par le client authentifié, donc par les politiques RLS : un
 * profil ne peut modifier que ses propres limites, et cette action ne peut pas
 * servir à toucher celles d'un autre même si on lui passait un identifiant.
 * C'est pour ça qu'elle n'en prend pas — le profil vient de la session.
 *
 * La validation applicative double celle de la base sans la remplacer. La base
 * reste l'autorité : elle refuserait une valeur hors bornes même si ce code
 * était contourné. Ce qu'on ajoute ici, c'est un message qu'un humain peut
 * lire, là où PostgreSQL ne renverrait qu'un nom de contrainte.
 */

export interface ResultatLimites {
  readonly ok: boolean;
  readonly message?: string;
  readonly erreurs?: Readonly<Partial<Record<CleLimite, string>>>;
  readonly incoherences?: readonly string[];
}

export async function enregistrerLimites(
  soumission: Partial<Record<CleLimite, unknown>>,
): Promise<ResultatLimites> {
  const validation = validerLimites(soumission);
  if (!validation.ok) {
    return {
      ok: false,
      message: 'Certaines valeurs ont été refusées : rien n’a été enregistré.',
      erreurs: validation.erreurs,
      incoherences: validation.incoherences,
    };
  }

  const valeurs = Object.fromEntries(
    CHAMPS_LIMITES.map((champ) => [champ.cle, Number(soumission[champ.cle])]),
  ) as ValeursLimites;

  const supabase = await clientServeur();
  const { data: session } = await supabase.auth.getClaims();
  const profilId = session?.claims?.sub;
  if (typeof profilId !== 'string') {
    return { ok: false, message: 'Session expirée.' };
  }

  const { parametresRisque, profils } = repartirParTable(valeurs);

  // Deux tables, donc deux écritures : PostgREST n'a pas de transaction ici.
  // Les limites de risque passent en premier — si le budget IA échouait
  // ensuite, on se retrouverait avec des garde-fous à jour et un plafond de
  // dépense inchangé, ce qui est le sens sûr de l'échec partiel.
  const { error: erreurRisque } = await supabase
    .from('parametres_risque')
    .update(parametresRisque)
    .eq('profil_id', profilId);
  if (erreurRisque) {
    return { ok: false, message: `Limites de risque refusées : ${erreurRisque.message}` };
  }

  const { error: erreurProfil } = await supabase
    .from('profils')
    .update(profils)
    .eq('id', profilId);
  if (erreurProfil) {
    return {
      ok: false,
      message:
        `Limites de risque enregistrées, mais le budget IA a été refusé : ${erreurProfil.message}`,
    };
  }

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Limites enregistrées. Elles s’appliquent au prochain ordre évalué.' };
}
