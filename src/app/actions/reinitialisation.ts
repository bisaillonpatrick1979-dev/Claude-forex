'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientServeur } from '@/lib/supabase/serveur';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Réinitialisation de la firme.
 *
 * Passe par le client authentifié et non par la clé de service : la fonction
 * en base lit `auth.uid()` pour savoir quel profil effacer. Avec la clé de
 * service, `auth.uid()` serait nul et il faudrait passer l'identifiant en
 * paramètre — soit exactement l'endroit où une erreur effacerait le compte
 * d'un autre.
 *
 * Aucune confirmation n'est demandée ici : c'est le rôle de l'interface, qui
 * fait saisir le montant à la main. Une action serveur qui redemande
 * confirmation donne une fausse impression de sécurité — elle est appelable
 * directement.
 */

export interface ResultatReinitialisation {
  readonly ok: boolean;
  readonly message: string;
}

const schema = z.object({
  capital: z.coerce
    .number()
    .positive('Le capital doit être strictement positif.')
    .max(100_000_000, 'Montant trop élevé.'),
  conserverLecons: z.boolean(),
  effacerHistorique: z.boolean(),
});

export type SaisieReinitialisation = z.input<typeof schema>;

export async function reinitialiserFirme(
  saisie: SaisieReinitialisation,
): Promise<ResultatReinitialisation> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  // Volontairement bas : une réinitialisation est irréversible, l'enchaîner
  // n'a aucun usage légitime.
  if (!limiterDebit(`reinit:${profilId}`, 3, 300_000).autorise) {
    return {
      ok: false,
      message: 'Trop de réinitialisations coup sur coup. Réessaie dans cinq minutes.',
    };
  }

  const analyse = schema.safeParse(saisie);
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Saisie invalide.' };
  }

  const supabase = await clientServeur();
  const { data, error } = await supabase.rpc('reinitialiser_firme', {
    p_capital: analyse.data.capital,
    p_conserver_lecons: analyse.data.conserverLecons,
    p_effacer_historique: analyse.data.effacerHistorique,
  });

  if (error) return { ok: false, message: error.message };

  const details = (data ?? {}) as { supprimes?: Record<string, number> };
  const supprimes = details.supprimes ?? {};
  const resume = Object.entries(supprimes)
    .filter(([, nombre]) => nombre > 0)
    .map(([table, nombre]) => `${nombre} ${table}`)
    .join(', ');

  revalidatePath('/salle-des-marches');
  revalidatePath('/performance');
  revalidatePath('/historique');
  revalidatePath('/reglages');

  return {
    ok: true,
    message: [
      `Portefeuille remis à ${analyse.data.capital.toFixed(2)}.`,
      resume ? `Effacé : ${resume}.` : 'Aucune donnée de trading à effacer.',
      analyse.data.conserverLecons
        ? 'Les leçons des agents sont conservées : ils gardent ce qu’ils ont appris.'
        : 'Les leçons ont été effacées : les agents repartent sans mémoire.',
    ].join(' '),
  };
}

/**
 * Change le capital sans rien effacer.
 *
 * Séparé de la réinitialisation parce que l'intention n'est pas la même :
 * ajuster une dotation en cours de route n'a aucune raison de détruire
 * l'historique. Le solde et l'équité sont décalés du même montant que le
 * capital, de sorte que le P&L déjà réalisé reste intact.
 */
export async function ajusterCapital(nouveauCapital: number): Promise<ResultatReinitialisation> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  const analyse = z
    .object({ capital: z.coerce.number().positive().max(100_000_000) })
    .safeParse({ capital: nouveauCapital });

  if (!analyse.success) {
    return { ok: false, message: 'Le capital doit être un montant positif.' };
  }

  const supabase = await clientServeur();
  const { data: portefeuille } = await supabase
    .from('portefeuilles')
    .select('id, capital_initial, solde, equite, sommet_equite, devise')
    .eq('profil_id', profilId)
    .limit(1)
    .maybeSingle();

  if (!portefeuille) return { ok: false, message: 'Aucun portefeuille pour ce profil.' };

  const ancien = Number(portefeuille.capital_initial);
  const ecart = analyse.data.capital - ancien;

  const { error } = await supabase
    .from('portefeuilles')
    .update({
      capital_initial: analyse.data.capital,
      // Décalage et non remplacement : le P&L réalisé se lit comme
      // « solde − capital initial ». Remplacer le solde ferait disparaître
      // tous les gains et pertes déjà encaissés.
      solde: Number(portefeuille.solde) + ecart,
      equite: Number(portefeuille.equite) + ecart,
      sommet_equite: Math.max(Number(portefeuille.sommet_equite) + ecart, analyse.data.capital),
    })
    .eq('id', portefeuille.id);

  if (error) return { ok: false, message: error.message };

  await supabase.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'AJUSTEMENT_CAPITAL',
    entite: 'portefeuilles',
    entite_id: portefeuille.id,
    details: { ancien, nouveau: analyse.data.capital, ecart },
  });

  revalidatePath('/salle-des-marches');
  revalidatePath('/reglages');

  return {
    ok: true,
    message: `Capital porté de ${ancien.toFixed(2)} à ${analyse.data.capital.toFixed(2)} ${portefeuille.devise}. Les gains et pertes déjà réalisés sont conservés.`,
  };
}
