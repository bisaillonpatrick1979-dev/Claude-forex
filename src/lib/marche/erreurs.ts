import type { CodeFournisseur } from './types';

/**
 * Erreurs typées plutôt qu'un `Error` générique : le routeur doit distinguer
 * « quota épuisé » (essayer le suivant, sans réessai) de « erreur réseau »
 * (réessai avec backoff) de « symbole inconnu » (ce fournisseur ne saura
 * jamais, inutile d'insister).
 */
export type CategorieErreur =
  | 'QUOTA_EPUISE'
  | 'AUTHENTIFICATION'
  | 'SYMBOLE_INCONNU'
  | 'RESEAU'
  | 'REPONSE_INVALIDE'
  | 'INCAPACITE';

export class ErreurFournisseur extends Error {
  readonly categorie: CategorieErreur;
  readonly fournisseur: CodeFournisseur;

  constructor(fournisseur: CodeFournisseur, categorie: CategorieErreur, message: string) {
    super(message);
    this.name = 'ErreurFournisseur';
    this.fournisseur = fournisseur;
    this.categorie = categorie;
  }

  /** Un réessai a-t-il une chance d'aboutir sur ce même fournisseur ? */
  get reessayable(): boolean {
    return this.categorie === 'RESEAU' || this.categorie === 'REPONSE_INVALIDE';
  }
}

/** Aucune source n'a pu servir la demande, cache périmé compris. */
export class ErreurDonneesIndisponibles extends Error {
  readonly incidents: readonly { fournisseur: CodeFournisseur; raison: string }[];

  constructor(
    message: string,
    incidents: readonly { fournisseur: CodeFournisseur; raison: string }[],
  ) {
    super(message);
    this.name = 'ErreurDonneesIndisponibles';
    this.incidents = incidents;
  }
}
