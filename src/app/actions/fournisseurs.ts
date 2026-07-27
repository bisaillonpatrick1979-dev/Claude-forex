'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  enregistrerCle,
  lireCle,
  supprimerCle,
  variablesReconnuesFournisseur,
} from '@/lib/marche/cles';
import { fournisseur as adaptateur } from '@/lib/marche/fournisseurs';
import { estCodeFournisseur, type ClasseActif } from '@/lib/marche/types';
import { chiffrementConfigure } from '@/lib/securite/chiffrement';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { clientServeur } from '@/lib/supabase/serveur';
import { profilAuthentifie } from '@/lib/supabase/session';

export interface ResultatFournisseur {
  readonly ok: boolean;
  readonly message: string;
}

const CONFIG_MANQUANTE =
  'SUPABASE_SERVICE_ROLE_KEY absente côté serveur : impossible de manipuler les clés API.';

const schemaCle = z.object({
  code: z.string().refine(estCodeFournisseur, 'Fournisseur inconnu.'),
  valeur: z.string().trim().min(8, 'La clé semble trop courte.').max(500),
});

/** Enregistre une clé API. La valeur en clair ne quitte jamais le serveur :
 *  elle est chiffrée immédiatement et seul un indice visuel est conservé
 *  pour l'affichage. */
export async function enregistrerCleFournisseur(
  code: string,
  valeur: string,
): Promise<ResultatFournisseur> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  if (!limiterDebit(`cle:${profilId}`, 10, 60_000).autorise) {
    return { ok: false, message: 'Trop de tentatives, réessaie dans une minute.' };
  }

  const analyse = schemaCle.safeParse({ code, valeur });
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Entrée invalide.' };
  }

  if (!chiffrementConfigure()) {
    const variables = variablesReconnuesFournisseur(analyse.data.code);
    return {
      ok: false,
      message:
        'CLE_CHIFFREMENT absente ou invalide côté serveur : rien n’a été enregistré, la clé serait stockée en clair. ' +
        (variables.length > 0
          ? `Deux solutions : ajouter CLE_CHIFFREMENT (32 octets en base64) aux variables d’environnement, ou y poser directement ${variables[0]} — dans ce cas la clé ne passe jamais par notre base et l’hébergeur la protège.`
          : 'Ajoutez CLE_CHIFFREMENT (32 octets en base64) aux variables d’environnement, puis redéployez.'),
    };
  }

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  await enregistrerCle(client, profilId, analyse.data.code, analyse.data.valeur);
  await client
    .from('fournisseurs_donnees')
    .update({ actif: true })
    .eq('profil_id', profilId)
    .eq('code', analyse.data.code);

  revalidatePath('/reglages/fournisseurs');
  return { ok: true, message: 'Clé enregistrée et fournisseur activé.' };
}

export async function supprimerCleFournisseur(code: string): Promise<ResultatFournisseur> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estCodeFournisseur(code)) return { ok: false, message: 'Fournisseur inconnu.' };

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  await supprimerCle(client, profilId, code);
  await client
    .from('fournisseurs_donnees')
    .update({ actif: false, dernier_statut: null, derniere_erreur: null })
    .eq('profil_id', profilId)
    .eq('code', code);

  revalidatePath('/reglages/fournisseurs');
  return { ok: true, message: 'Clé supprimée, fournisseur désactivé.' };
}

/** Bascule l'activation. Un fournisseur qui exige une clé absente ne peut pas
 *  être activé : autant le dire tout de suite. */
export async function basculerFournisseur(
  code: string,
  actif: boolean,
): Promise<ResultatFournisseur> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estCodeFournisseur(code)) return { ok: false, message: 'Fournisseur inconnu.' };

  const implementation = adaptateur(code);
  if (actif && implementation?.capacites().necessiteCle) {
    const client = clientAdminOptionnel();
    if (!client) return { ok: false, message: CONFIG_MANQUANTE };
    const cle = await lireCle(client, profilId, code);
    if (!cle) {
      return { ok: false, message: 'Ce fournisseur exige une clé API : enregistre-la d’abord.' };
    }
  }

  const supabase = await clientServeur();
  const { error } = await supabase
    .from('fournisseurs_donnees')
    .update({ actif })
    .eq('profil_id', profilId)
    .eq('code', code);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/reglages/fournisseurs');
  return { ok: true, message: actif ? 'Fournisseur activé.' : 'Fournisseur désactivé.' };
}

const CLASSES: readonly ClasseActif[] = [
  'FOREX',
  'INDICE',
  'ACTION',
  'CRYPTO',
  'MATIERE_PREMIERE',
];

/** Priorité par classe d'actifs : 1 = essayé en premier, vide = non éligible. */
export async function definirPriorite(
  code: string,
  classe: string,
  priorite: number | null,
): Promise<ResultatFournisseur> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estCodeFournisseur(code)) return { ok: false, message: 'Fournisseur inconnu.' };
  if (!(CLASSES as readonly string[]).includes(classe)) {
    return { ok: false, message: 'Classe d’actifs inconnue.' };
  }
  if (priorite !== null && (!Number.isInteger(priorite) || priorite < 1 || priorite > 9)) {
    return { ok: false, message: 'La priorité doit être un entier de 1 à 9.' };
  }

  const supabase = await clientServeur();
  const { data } = await supabase
    .from('fournisseurs_donnees')
    .select('priorite_par_classe')
    .eq('profil_id', profilId)
    .eq('code', code)
    .maybeSingle();

  const actuelles =
    typeof data?.priorite_par_classe === 'object' && data.priorite_par_classe !== null
      ? { ...(data.priorite_par_classe as Record<string, number>) }
      : {};

  if (priorite === null) {
    delete actuelles[classe];
  } else {
    actuelles[classe] = priorite;
  }

  const { error } = await supabase
    .from('fournisseurs_donnees')
    .update({ priorite_par_classe: actuelles })
    .eq('profil_id', profilId)
    .eq('code', code);

  if (error) return { ok: false, message: error.message };

  revalidatePath('/reglages/fournisseurs');
  return { ok: true, message: 'Priorité mise à jour.' };
}

/** Test de connexion réel : un appel minimal au fournisseur, avec sa clé. */
export async function testerFournisseur(code: string): Promise<ResultatFournisseur> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estCodeFournisseur(code)) return { ok: false, message: 'Fournisseur inconnu.' };

  if (!limiterDebit(`test:${profilId}`, 10, 60_000).autorise) {
    return { ok: false, message: 'Trop de tests, réessaie dans une minute.' };
  }

  const implementation = adaptateur(code);
  if (!implementation) {
    return { ok: false, message: 'Adaptateur non livré : rien à tester pour l’instant.' };
  }

  const client = clientAdminOptionnel();
  const cle = implementation.capacites().necessiteCle
    ? client
      ? ((await lireCle(client, profilId, code)) ?? undefined)
      : undefined
    : undefined;

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), 10_000);
  try {
    const resultat = await implementation.tester({ cle, signal: controleur.signal });

    if (client) {
      await client
        .from('fournisseurs_donnees')
        .update({
          dernier_statut: resultat.ok ? 'OK' : 'ERREUR',
          derniere_erreur: resultat.ok ? null : resultat.message,
          derniere_verification_le: new Date().toISOString(),
        })
        .eq('profil_id', profilId)
        .eq('code', code);
    }

    revalidatePath('/reglages/fournisseurs');
    return {
      ok: resultat.ok,
      message: `${resultat.message} (${resultat.latenceMs} ms)`,
    };
  } finally {
    clearTimeout(minuterie);
  }
}
