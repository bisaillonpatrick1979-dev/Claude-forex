/**
 * File d'attente par adaptateur, avec repli exponentiel.
 *
 * Chaque fournisseur a sa limite : Alpha Vantage tolère cinq appels par minute,
 * Binance en accepte des centaines. Les traiter pareil garantit soit de gaspiller
 * la marge de l'un, soit de se faire bannir par l'autre.
 *
 * Deux mécanismes, volontairement distincts :
 *
 *   - **la file** sérialise les appels d'un même adaptateur et espace chacun du
 *     délai minimal. Sans elle, dix requêtes parties en parallèle franchissent
 *     n'importe quelle limite avant que la première réponse n'arrive ;
 *   - **le repli** attend de plus en plus longtemps après un refus, avec un
 *     bruit aléatoire. Sans ce bruit, deux onglets ouverts réessaient à la
 *     milliseconde près et se refont refuser ensemble indéfiniment.
 */

export interface RateLimitConfig {
  /** Appels autorisés par fenêtre. */
  readonly maxCalls: number;
  /** Durée de la fenêtre, en millisecondes. */
  readonly windowMs: number;
  readonly maxRetries: number;
  readonly baseBackoffMs: number;
}

export const DEFAULT_LIMITS: RateLimitConfig = {
  maxCalls: 10,
  windowMs: 60_000,
  maxRetries: 3,
  baseBackoffMs: 1_000,
};

const attendre = (ms: number): Promise<void> =>
  new Promise((resoudre) => setTimeout(resoudre, ms));

export class RateLimiter {
  private readonly config: RateLimitConfig;
  /** Horodatages des appels récents, dans la fenêtre glissante. */
  private readonly recents: number[] = [];
  /** Chaîne de promesses : garantit qu'un seul appel part à la fois. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_LIMITS, ...config };
  }

  /** Appels encore disponibles dans la fenêtre courante. */
  remaining(now: number = Date.now()): number {
    this.purger(now);
    return Math.max(0, this.config.maxCalls - this.recents.length);
  }

  /**
   * Exécute en respectant la limite, avec réessais.
   *
   * `estRecuperable` décide de réessayer : une clé refusée ne le sera jamais,
   * insister ne ferait que retarder l'affichage du vrai message.
   */
  async run<T>(
    tache: () => Promise<T>,
    estRecuperable: (erreur: unknown) => boolean = () => false,
  ): Promise<T> {
    const execution = this.queue.then(async () => {
      let derniereErreur: unknown;

      for (let tentative = 0; tentative <= this.config.maxRetries; tentative += 1) {
        await this.attendreCreneau();

        try {
          this.recents.push(Date.now());
          return await tache();
        } catch (erreur) {
          derniereErreur = erreur;
          if (!estRecuperable(erreur) || tentative === this.config.maxRetries) throw erreur;

          // Repli exponentiel avec bruit : 1 s, 2 s, 4 s, ± 30 %.
          const base = this.config.baseBackoffMs * 2 ** tentative;
          const bruit = base * 0.3 * (Math.random() * 2 - 1);
          await attendre(Math.max(0, base + bruit));
        }
      }

      throw derniereErreur;
    });

    // La file continue même si cette tâche échoue : une erreur ne doit pas
    // bloquer définitivement les appels suivants.
    this.queue = execution.then(
      () => undefined,
      () => undefined,
    );

    return execution;
  }

  private async attendreCreneau(): Promise<void> {
    for (;;) {
      const maintenant = Date.now();
      this.purger(maintenant);

      if (this.recents.length < this.config.maxCalls) return;

      const plusAncien = this.recents[0];
      if (plusAncien === undefined) return;

      // On attend juste ce qu'il faut pour que le plus ancien sorte de la
      // fenêtre, plus une marge d'une milliseconde.
      await attendre(plusAncien + this.config.windowMs - maintenant + 1);
    }
  }

  private purger(maintenant: number): void {
    const limite = maintenant - this.config.windowMs;
    while (this.recents.length > 0 && (this.recents[0] ?? 0) <= limite) {
      this.recents.shift();
    }
  }
}

/** Un limiteur par adaptateur : les fenêtres ne se partagent pas. */
const limiteurs = new Map<string, RateLimiter>();

export function limiterFor(adapterId: string, config?: Partial<RateLimitConfig>): RateLimiter {
  const existant = limiteurs.get(adapterId);
  if (existant) return existant;

  const cree = new RateLimiter(config);
  limiteurs.set(adapterId, cree);
  return cree;
}
