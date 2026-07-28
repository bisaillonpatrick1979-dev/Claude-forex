/**
 * Bus d'événements typé, synchrone.
 *
 * Synchrone volontairement : livrer les événements dans une micro-tâche
 * laisserait la bougie suivante entrer dans le moteur avant que les
 * conséquences de la précédente soient enregistrées. L'ordre des événements est
 * ce qui garantit qu'aucune décision ne lit son propre résultat.
 *
 * Un abonné qui lève n'interrompt pas les autres : l'interface qui plante en
 * dessinant un marqueur ne doit pas arrêter le moteur au milieu d'un
 * remplissage.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events> {
  private readonly abonnes = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    const ensemble = this.abonnes.get(type) ?? new Set<Listener<never>>();
    ensemble.add(listener as Listener<never>);
    this.abonnes.set(type, ensemble);
    return () => {
      ensemble.delete(listener as Listener<never>);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const ensemble = this.abonnes.get(type);
    if (!ensemble) return;

    // Copie : un abonné peut se désabonner en réagissant, et modifier
    // l'ensemble pendant qu'on le parcourt sauterait l'abonné suivant.
    for (const listener of [...ensemble]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (cause) {
        console.error(`[EventBus] abonné en erreur sur « ${String(type)} »`, cause);
      }
    }
  }

  clear(): void {
    this.abonnes.clear();
  }
}
