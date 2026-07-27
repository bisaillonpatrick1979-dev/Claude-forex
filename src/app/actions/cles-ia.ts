'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { adaptateur, estFournisseurLLM, FOURNISSEURS_LLM } from '@/lib/ia';
import { cleDepuisEnvironnement, variablesReconnues } from '@/lib/ia/appel';
import { MODELES_PAR_FOURNISSEUR } from '@/lib/ia/tarifs';
import type { FournisseurLLM } from '@/lib/ia/types';
import { enregistrerCle, lireCle, supprimerCle } from '@/lib/marche/cles';
import { chiffrementConfigure } from '@/lib/securite/chiffrement';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Clés API des fournisseurs de modèles.
 *
 * Séparées des clés de données de marché : ce ne sont ni les mêmes comptes, ni
 * les mêmes factures, ni les mêmes conséquences quand l'une manque. Une clé de
 * marché absente fait basculer le routeur sur le fournisseur suivant ; une clé
 * de modèle absente rend l'agent muet.
 *
 * Le stockage, lui, est commun (`cles_api`, chiffrées AES-256-GCM) : deux
 * mécanismes de chiffrement en parallèle, c'est un de trop à auditer.
 */

export interface ResultatCleIa {
  readonly ok: boolean;
  readonly message: string;
}

const CONFIG_MANQUANTE =
  'SUPABASE_SERVICE_ROLE_KEY absente côté serveur : impossible de manipuler les clés API.';

const schema = z.object({
  fournisseur: z.string().refine(estFournisseurLLM, 'Fournisseur inconnu.'),
  valeur: z.string().trim().min(8, 'La clé semble trop courte.').max(500),
});

export async function enregistrerCleIa(
  fournisseur: string,
  valeur: string,
): Promise<ResultatCleIa> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  if (!limiterDebit(`cle-ia:${profilId}`, 10, 60_000).autorise) {
    return { ok: false, message: 'Trop de tentatives, réessaie dans une minute.' };
  }

  const analyse = schema.safeParse({ fournisseur, valeur });
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Entrée invalide.' };
  }

  if (analyse.data.fournisseur === 'mock') {
    return { ok: false, message: 'La simulation locale n’utilise aucune clé.' };
  }

  if (!chiffrementConfigure()) {
    return {
      ok: false,
      message:
        'CLE_CHIFFREMENT absente ou invalide côté serveur : la clé ne serait pas chiffrée au repos. Rien n’a été enregistré.',
    };
  }

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  await enregistrerCle(client, profilId, analyse.data.fournisseur, analyse.data.valeur);

  revalidatePath('/reglages/ia');
  revalidatePath('/agents');
  return {
    ok: true,
    message: `Clé ${adaptateur(analyse.data.fournisseur).nom} enregistrée et chiffrée.`,
  };
}

export async function supprimerCleIa(fournisseur: string): Promise<ResultatCleIa> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estFournisseurLLM(fournisseur)) return { ok: false, message: 'Fournisseur inconnu.' };

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  // Un agent qui pointe encore sur ce fournisseur deviendrait muet au prochain
  // cycle. On le dit maintenant plutôt que de le laisser échouer plus tard.
  const { count } = await client
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('profil_id', profilId)
    .eq('fournisseur_llm', fournisseur);

  await supprimerCle(client, profilId, fournisseur);

  revalidatePath('/reglages/ia');
  revalidatePath('/agents');
  return {
    ok: true,
    message:
      (count ?? 0) > 0
        ? `Clé supprimée. Attention : ${count} agent(s) utilisent encore ${adaptateur(fournisseur).nom} et ne pourront plus répondre.`
        : 'Clé supprimée.',
  };
}

/**
 * Test réel : un appel minimal, avec la clé enregistrée.
 *
 * Vérifier le format d'une clé ne prouve rien — seul un aller-retour dit si
 * elle est valide, si le compte est approvisionné et si le modèle est
 * accessible.
 */
export async function testerCleIa(fournisseur: string): Promise<ResultatCleIa> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estFournisseurLLM(fournisseur)) return { ok: false, message: 'Fournisseur inconnu.' };

  if (!limiterDebit(`test-ia:${profilId}`, 10, 60_000).autorise) {
    return { ok: false, message: 'Trop de tests, réessaie dans une minute.' };
  }

  const implementation = adaptateur(fournisseur as FournisseurLLM);
  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  const cle = implementation.necessiteCle
    ? ((await lireCle(client, profilId, fournisseur)) ??
      cleDepuisEnvironnement(fournisseur as FournisseurLLM))
    : undefined;

  if (implementation.necessiteCle && !cle) {
    return {
      ok: false,
      message: `Aucune clé : ni enregistrée ici, ni dans ${variablesReconnues(fournisseur as FournisseurLLM).join(' ou ')}.`,
    };
  }

  // Le modèle le moins cher de la grille : un test ne doit pas coûter le prix
  // d'une analyse complète.
  const modeles = MODELES_PAR_FOURNISSEUR[fournisseur as FournisseurLLM];
  const modele = modeles[modeles.length - 1] ?? modeles[0];
  if (!modele) return { ok: false, message: 'Aucun modèle connu pour ce fournisseur.' };

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), 20_000);

  try {
    const reponse = await implementation.appeler(
      {
        modele,
        systeme: 'Tu réponds en un seul mot.',
        messages: [{ role: 'utilisateur', contenu: 'Réponds exactement : OK' }],
        tokensMax: 16,
        temperature: null,
        signal: controleur.signal,
      },
      { cle },
    );

    return {
      ok: true,
      message: `${implementation.nom} répond en ${reponse.latenceMs} ms avec ${modele} (${reponse.tokensEntree} + ${reponse.tokensSortie} tokens).`,
    };
  } catch (erreur) {
    return {
      ok: false,
      message: erreur instanceof Error ? erreur.message : 'Appel impossible.',
    };
  } finally {
    clearTimeout(minuterie);
  }
}

/** Assigne un fournisseur et un modèle à tous les agents d'un coup. Sert à
 *  basculer la firme entière sans passer par douze menus. */
export async function appliquerModeleATousLesAgents(
  fournisseur: string,
  modele: string,
): Promise<ResultatCleIa> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };
  if (!estFournisseurLLM(fournisseur)) return { ok: false, message: 'Fournisseur inconnu.' };

  const modeles = MODELES_PAR_FOURNISSEUR[fournisseur as FournisseurLLM];
  if (!modeles.includes(modele)) {
    return { ok: false, message: 'Ce modèle n’appartient pas à ce fournisseur.' };
  }

  const client = clientAdminOptionnel();
  if (!client) return { ok: false, message: CONFIG_MANQUANTE };

  if (fournisseur !== 'mock') {
    const cle =
      (await lireCle(client, profilId, fournisseur)) ??
      cleDepuisEnvironnement(fournisseur as FournisseurLLM);
    if (!cle) {
      return {
        ok: false,
        message: 'Enregistrez d’abord une clé pour ce fournisseur : les agents seraient muets.',
      };
    }
  }

  const { error } = await client
    .from('agents')
    .update({ fournisseur_llm: fournisseur as FournisseurLLM, modele })
    .eq('profil_id', profilId);

  if (error) return { ok: false, message: error.message };

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'MODELE_APPLIQUE_A_TOUS',
    entite: 'agents',
    entite_id: null,
    details: { fournisseur, modele },
  });

  revalidatePath('/reglages/ia');
  revalidatePath('/agents');
  return { ok: true, message: `Les douze agents utilisent désormais ${modele}.` };
}

export async function listerFournisseursIa(): Promise<
  readonly {
    code: FournisseurLLM;
    nom: string;
    necessiteCle: boolean;
    modeles: readonly string[];
  }[]
> {
  return FOURNISSEURS_LLM.map((code) => {
    const implementation = adaptateur(code);
    return {
      code,
      nom: implementation.nom,
      necessiteCle: implementation.necessiteCle,
      modeles: implementation.modeles,
    };
  });
}
