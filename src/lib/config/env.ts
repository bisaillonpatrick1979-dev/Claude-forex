import { z } from 'zod';

/**
 * Validation des variables d'environnement.
 *
 * La lecture est paresseuse et mémoïsée : `next build` doit pouvoir compiler
 * sans qu'un secret soit présent, sinon impossible de bâtir une image sans
 * accès aux secrets de production. L'erreur survient au premier usage réel,
 * avec un message explicite plutôt qu'un « undefined » plus loin dans la pile.
 */

const schemaPublic = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL doit être une URL valide"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquante'),
});

const schemaServeur = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY manquante'),
});

export type EnvPublic = z.infer<typeof schemaPublic>;
export type EnvServeur = z.infer<typeof schemaServeur>;

let cachePublic: EnvPublic | null = null;
let cacheServeur: EnvServeur | null = null;

function echouer(erreur: z.ZodError): never {
  // Le nom de la variable vient du chemin de l'erreur, pas du message : Zod
  // rend « Invalid input » pour plusieurs validateurs, ce qui produisait un
  // journal de production strictement inutilisable — « Invalid input | Invalid
  // input » sans dire laquelle des deux variables manquait.
  //
  // On n'imprime jamais la valeur, seulement le nom.
  const details = erreur.issues
    .map((probleme) => `${probleme.path.join('.') || 'variable inconnue'} (${probleme.message})`)
    .join(' | ');
  throw new Error(`Configuration d'environnement invalide — ${details}`);
}

/** Variables lisibles côté navigateur. Next.js les inline au build. */
export function envPublic(): EnvPublic {
  if (cachePublic) return cachePublic;
  const resultat = schemaPublic.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!resultat.success) echouer(resultat.error);
  cachePublic = resultat.data;
  return cachePublic;
}

/**
 * Variante non levante : rend `null` quand la configuration publique est
 * absente. Sert aux points d'entrée qui doivent rester affichables sur un
 * déploiement mal configuré — un écran qui dit ce qui manque vaut mieux qu'une
 * erreur 500 opaque sur toutes les pages.
 */
export function envPublicOptionnel(): EnvPublic | null {
  try {
    return envPublic();
  } catch {
    return null;
  }
}

/** Noms des variables publiques absentes, pour les afficher telles quelles. */
export function variablesPubliquesManquantes(): readonly string[] {
  const manquantes: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) manquantes.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    manquantes.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  return manquantes;
}

/**
 * Variables strictement serveur. Appeler cette fonction depuis un composant
 * client ferait fuiter un secret : le garde ci-dessous rend la faute bruyante.
 */
export function envServeur(): EnvServeur {
  if (typeof window !== 'undefined') {
    throw new Error('envServeur() a été appelée côté navigateur.');
  }
  if (cacheServeur) return cacheServeur;
  const resultat = schemaServeur.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!resultat.success) echouer(resultat.error);
  cacheServeur = resultat.data;
  return cacheServeur;
}
