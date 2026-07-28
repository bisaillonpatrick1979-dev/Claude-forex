import { TIMEFRAME_SECONDS, type Timeframe } from '@/types/market';

/**
 * Horloge simulée. Seule source de temps du moteur.
 *
 * Rien dans `src/engine/` n'a le droit d'appeler `Date.now()`. Un backtest qui
 * lirait l'heure réelle donnerait un résultat différent selon le moment où on
 * l'exécute, et une stratégie pourrait comparer l'heure système à l'heure de la
 * bougie — ce qui revient à savoir qu'on est dans le passé, donc à savoir la
 * suite.
 *
 * En rejeu comme en direct, le moteur n'a qu'une notion du présent : la
 * clôture de la dernière bougie reçue.
 */
export class Clock {
  private courant: number;

  constructor(depart = 0) {
    this.courant = depart;
  }

  now(): number {
    return this.courant;
  }

  /**
   * Avance à la clôture d'une bougie.
   *
   * `bar.time` marque l'ouverture ; le moteur ne voit la bougie qu'une fois
   * close, donc le présent est `ouverture + durée`. Se tromper d'un pas ici
   * ferait croire au moteur qu'il connaît une bougie une période trop tôt.
   */
  advanceToClose(barTime: number, timeframe: Timeframe): number {
    const cloture = barTime + TIMEFRAME_SECONDS[timeframe];
    // Une horloge qui recule autoriserait à rejouer une décision déjà prise
    // avec ce qu'on a appris depuis.
    if (cloture < this.courant) {
      throw new Error(
        `Horloge : recul interdit (${this.courant} → ${cloture}). Série non triée ?`,
      );
    }
    this.courant = cloture;
    return this.courant;
  }

  reset(depart = 0): void {
    this.courant = depart;
  }
}
