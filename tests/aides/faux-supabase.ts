import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/base-de-donnees';

/**
 * Faux client Supabase, minimal mais fidèle aux appels que fait le routeur.
 *
 * Écrit à la main plutôt qu'avec une bibliothèque de mocks : le routeur
 * n'utilise qu'une poignée de formes de requêtes, et un faux explicite se lit
 * mieux qu'une pile de `vi.fn()` — on voit exactement ce que la base est
 * censée répondre.
 */

export type Ligne = Record<string, unknown>;
export type Donnees = Record<string, Ligne[]>;

interface Ecriture {
  readonly table: string;
  readonly operation: 'update' | 'upsert' | 'insert' | 'delete';
  readonly valeurs: unknown;
}

class Requete implements PromiseLike<{ data: Ligne[]; error: null }> {
  private readonly filtres: [string, unknown][] = [];
  private limite: number | null = null;

  constructor(
    private readonly table: string,
    private readonly donnees: Donnees,
    private readonly ecritures: Ecriture[],
    private readonly mutation: Ecriture | null = null,
  ) {}

  select(): this {
    return this;
  }

  eq(colonne: string, valeur: unknown): this {
    this.filtres.push([colonne, valeur]);
    return this;
  }

  order(): this {
    return this;
  }

  limit(nombre: number): this {
    this.limite = nombre;
    return this;
  }

  private resoudre(): Ligne[] {
    const lignes = (this.donnees[this.table] ?? []).filter((ligne) =>
      this.filtres.every(([colonne, valeur]) => ligne[colonne] === valeur),
    );
    return this.limite === null ? lignes : lignes.slice(0, this.limite);
  }

  async maybeSingle(): Promise<{ data: Ligne | null; error: null }> {
    return { data: this.resoudre()[0] ?? null, error: null };
  }

  then<R1 = { data: Ligne[]; error: null }, R2 = never>(
    onfulfilled?: ((valeur: { data: Ligne[]; error: null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((raison: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    if (this.mutation) this.ecritures.push(this.mutation);
    const resultat = { data: this.resoudre(), error: null as null };
    return Promise.resolve(resultat).then(onfulfilled, onrejected);
  }
}

export interface FauxClient {
  readonly client: SupabaseClient<Database>;
  readonly ecritures: Ecriture[];
}

export function fauxClient(donnees: Donnees): FauxClient {
  const ecritures: Ecriture[] = [];

  const client = {
    from(table: string) {
      return {
        select: () => new Requete(table, donnees, ecritures),
        update: (valeurs: unknown) =>
          new Requete(table, donnees, ecritures, { table, operation: 'update', valeurs }),
        upsert: async (valeurs: unknown) => {
          ecritures.push({ table, operation: 'upsert', valeurs });
          return { data: null, error: null };
        },
        insert: async (valeurs: unknown) => {
          ecritures.push({ table, operation: 'insert', valeurs });
          return { data: null, error: null };
        },
        delete: () =>
          new Requete(table, donnees, ecritures, { table, operation: 'delete', valeurs: null }),
      };
    },
  };

  // Le faux ne couvre volontairement qu'une partie de la surface du vrai
  // client ; la conversion est confinée à ce fichier de test.
  return { client: client as unknown as SupabaseClient<Database>, ecritures };
}
