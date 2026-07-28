import type { UniverseContext, UniverseModule } from '../interfaces';

/**
 * Univers fixe : la liste que l'utilisateur a choisie, rien d'autre.
 *
 * Le plus simple des univers, et le seul honnête tant qu'on n'a pas d'historique
 * de composition. Un univers « dynamique » construit à partir des instruments
 * qui existent aujourd'hui est un biais du survivant : il ne contient que les
 * entreprises qui n'ont pas fait faillite, ce qui suffit à rendre n'importe
 * quelle stratégie profitable dans le passé.
 */
export class StaticUniverse implements UniverseModule {
  readonly id = 'static';

  private readonly symboles: readonly string[];

  constructor(symboles: readonly string[]) {
    this.symboles = [...symboles];
  }

  select(ctx: UniverseContext): readonly string[] {
    if (this.symboles.length === 0) return ctx.candidates;
    // Intersection : un symbole demandé mais sans données n'est pas tradable.
    return this.symboles.filter((symbole) => ctx.candidates.includes(symbole));
  }
}
