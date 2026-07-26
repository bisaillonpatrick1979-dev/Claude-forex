/**
 * Limitation de débit des Route Handlers.
 *
 * Implémentation en mémoire, par instance. Sur Vercel, chaque instance
 * serverless a son propre compteur : le plafond réel est donc « N par instance »
 * et non « N au total ». C'est une protection contre une boucle d'appels
 * accidentelle depuis l'UI, pas contre un attaquant distribué.
 *
 * Dette assumée, documentée dans NOTES.md : un vrai compteur partagé demande
 * Redis (Upstash) ou une table Postgres avec une écriture par requête. Les deux
 * coûtent — le premier en palier payant, le second en quota de base gratuite.
 * Le vrai garde-fou contre l'épuisement des quotas fournisseurs est ailleurs :
 * c'est le compteur persisté de `quotas.ts`.
 */

interface Seau {
  jetons: number;
  dernierRemplissage: number;
}

const SEAUX = new Map<string, Seau>();

/** Purge périodique : sans ça, la Map croît indéfiniment sur une instance
 *  longue durée. */
function purger(maintenant: number, fenetreMs: number): void {
  if (SEAUX.size < 1000) return;
  for (const [cle, seau] of SEAUX) {
    if (maintenant - seau.dernierRemplissage > fenetreMs * 2) SEAUX.delete(cle);
  }
}

export interface ResultatLimitation {
  readonly autorise: boolean;
  readonly restant: number;
  readonly reessayerDansMs: number;
}

export function limiterDebit(
  cle: string,
  maxParFenetre: number,
  fenetreMs: number,
  maintenant: number = Date.now(),
): ResultatLimitation {
  purger(maintenant, fenetreMs);

  const seau = SEAUX.get(cle) ?? { jetons: maxParFenetre, dernierRemplissage: maintenant };
  const ecoule = maintenant - seau.dernierRemplissage;

  // Remplissage continu plutôt que fenêtre fixe : évite la rafale au moment
  // où la fenêtre bascule.
  const regeneres = (ecoule / fenetreMs) * maxParFenetre;
  seau.jetons = Math.min(maxParFenetre, seau.jetons + regeneres);
  seau.dernierRemplissage = maintenant;

  if (seau.jetons < 1) {
    SEAUX.set(cle, seau);
    const manque = 1 - seau.jetons;
    return {
      autorise: false,
      restant: 0,
      reessayerDansMs: Math.ceil((manque / maxParFenetre) * fenetreMs),
    };
  }

  seau.jetons -= 1;
  SEAUX.set(cle, seau);
  return { autorise: true, restant: Math.floor(seau.jetons), reessayerDansMs: 0 };
}

/** Réservé aux tests : repart d'un état vierge. */
export function reinitialiserLimitation(): void {
  SEAUX.clear();
}
