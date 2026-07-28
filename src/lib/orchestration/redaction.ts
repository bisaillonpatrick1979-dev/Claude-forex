/**
 * Écriture progressive d'un message d'agent pendant qu'il se rédige.
 *
 * Le fil des spécialistes affichait chaque prise de parole d'un bloc, à la
 * fin : quarante secondes de « réfléchit… », puis six cents mots d'un coup. Le
 * modèle, lui, produit son texte token par token. Ce module transporte cette
 * progression jusqu'à l'écran.
 *
 * ── Pourquoi passer par la base plutôt que par un flux HTTP ─────────────────
 *
 * Un flux direct du serveur vers le navigateur ne marcherait que pour la
 * personne qui a lancé le cycle. Or un cycle peut aussi partir d'un cron, sans
 * que personne ne regarde, et l'écran doit quand même le montrer quand on
 * l'ouvre. La ligne `messages_agents` est déjà la source de vérité, et
 * Realtime la pousse à tous les écrans connectés : on écrit donc le texte
 * partiel au même endroit que le texte final.
 *
 * ── Pourquoi ne pas écrire à chaque token ───────────────────────────────────
 *
 * Un `update` par token ferait des milliers d'écritures par message et
 * saturerait Realtime pour un gain invisible — l'œil ne distingue pas dix
 * rafraîchissements par seconde. On écrit donc quand **deux** conditions sont
 * réunies : assez de temps écoulé, et assez de texte nouveau. Un modèle lent
 * n'écrit pas pour trois caractères, un modèle rapide n'écrit pas trente fois
 * par seconde.
 *
 * ── La course qu'il fallait fermer ──────────────────────────────────────────
 *
 * Une écriture partielle lancée juste avant la fin de l'appel peut se terminer
 * **après** l'écriture du message complet, et le remplacer par un fragment. Le
 * message resterait tronqué pour toujours, sans erreur nulle part.
 *
 * `cloturer()` ferme donc le rédacteur — plus aucune écriture ne part — et
 * attend celle qui est en vol. L'appelant n'écrit le contenu définitif
 * qu'après. C'est la raison d'être de ce module ; le reste n'est que cadence.
 */

export interface OptionsRedaction {
  /** Écriture effective. Les erreurs sont avalées : un fil qui bégaie ne doit
   *  jamais faire échouer le cycle qui le produit. */
  readonly ecrire: (texte: string) => Promise<void>;
  readonly intervalleMs?: number;
  readonly minimumCaracteres?: number;
  /** Horloge injectable, pour que les tests n'attendent pas réellement. */
  readonly maintenant?: () => number;
}

/** Assez lent pour ne pas noyer Realtime, assez rapide pour qu'on voie écrire. */
export const INTERVALLE_ECRITURE_MS = 400;

/** En dessous, le rafraîchissement ne se voit pas et l'écriture est gâchée. */
export const MINIMUM_CARACTERES = 24;

export interface Redacteur {
  /** Ajoute un fragment au texte en cours. Ne bloque jamais. */
  pousser(fragment: string): void;
  /** Texte accumulé jusqu'ici. */
  texte(): string;
  /** Ferme le rédacteur et attend l'écriture en vol. Idempotent. */
  cloturer(): Promise<void>;
}

export function redacteurProgressif(options: OptionsRedaction): Redacteur {
  const intervalle = options.intervalleMs ?? INTERVALLE_ECRITURE_MS;
  const minimum = options.minimumCaracteres ?? MINIMUM_CARACTERES;
  const maintenant = options.maintenant ?? (() => Date.now());

  let accumule = '';
  /** Longueur déjà écrite, pour mesurer ce que le prochain envoi apporterait. */
  let ecrit = 0;
  let dernierEnvoi = maintenant();
  let ferme = false;
  let enVol: Promise<void> | null = null;

  function envoyer(): void {
    // Une seule écriture à la fois : sous une écriture lente, empiler les
    // suivantes les ferait arriver dans le désordre, et un fragment ancien
    // écraserait un fragment récent.
    if (ferme || enVol !== null) return;

    const texte = accumule;
    const longueur = texte.length;
    dernierEnvoi = maintenant();
    ecrit = longueur;

    enVol = options
      .ecrire(texte)
      .catch(() => undefined)
      .finally(() => {
        enVol = null;
      });
  }

  return {
    pousser(fragment: string): void {
      if (ferme || fragment.length === 0) return;
      accumule += fragment;

      const assezDeTexte = accumule.length - ecrit >= minimum;
      const assezDeTemps = maintenant() - dernierEnvoi >= intervalle;
      if (assezDeTexte && assezDeTemps) envoyer();
    },

    texte(): string {
      return accumule;
    },

    async cloturer(): Promise<void> {
      ferme = true;
      await enVol;
    },
  };
}
