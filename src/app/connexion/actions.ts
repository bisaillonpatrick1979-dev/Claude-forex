'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { clientServeur } from '@/lib/supabase/serveur';

export interface EtatFormulaire {
  readonly erreur?: string;
  readonly info?: string;
}

const schemaIdentifiants = z.object({
  courriel: z.string().email('Adresse courriel invalide.'),
  motDePasse: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères.'),
});

/** Les redirections internes uniquement : un `suivant` externe serait une
 *  redirection ouverte. */
function destination(suivant: FormDataEntryValue | null): string {
  const valeur = typeof suivant === 'string' ? suivant : '';
  return valeur.startsWith('/') && !valeur.startsWith('//') ? valeur : '/salle-des-marches';
}

export async function connexion(
  _precedent: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  const analyse = schemaIdentifiants.safeParse({
    courriel: donnees.get('courriel'),
    motDePasse: donnees.get('motDePasse'),
  });
  if (!analyse.success) {
    return { erreur: analyse.error.issues[0]?.message ?? 'Identifiants invalides.' };
  }

  const supabase = await clientServeur();
  const { error } = await supabase.auth.signInWithPassword({
    email: analyse.data.courriel,
    password: analyse.data.motDePasse,
  });

  if (error) {
    // Message volontairement générique : ne pas révéler si le compte existe.
    return { erreur: 'Identifiants refusés.' };
  }

  redirect(destination(donnees.get('suivant')));
}

export async function inscription(
  _precedent: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  const analyse = schemaIdentifiants.safeParse({
    courriel: donnees.get('courriel'),
    motDePasse: donnees.get('motDePasse'),
  });
  if (!analyse.success) {
    return { erreur: analyse.error.issues[0]?.message ?? 'Identifiants invalides.' };
  }

  const supabase = await clientServeur();
  const { data, error } = await supabase.auth.signUp({
    email: analyse.data.courriel,
    password: analyse.data.motDePasse,
  });

  if (error) {
    return { erreur: error.message };
  }

  // Sans session, Supabase attend une confirmation par courriel. La firme
  // (profil, portefeuille, 12 agents) est déjà créée par le trigger en base.
  if (!data.session) {
    return {
      info: 'Compte créé. Ouvre le lien de confirmation reçu par courriel, puis connecte-toi.',
    };
  }

  redirect('/salle-des-marches');
}

export async function deconnexion(): Promise<void> {
  const supabase = await clientServeur();
  await supabase.auth.signOut();
  redirect('/connexion');
}
