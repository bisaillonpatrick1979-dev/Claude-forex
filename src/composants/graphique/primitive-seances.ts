import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ITimeScaleApi,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';

import {
  COULEURS_BANDES,
  bandesSeances,
  bandesPertinentes,
  type BandeSeance,
} from '@/lib/graphique/bandes-seances';
import { nomSeance } from '@/lib/marche/seances-mondiales';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Bandes de séance peintes sous les chandeliers.
 *
 * C'est l'indicateur que proposent toutes les plateformes professionnelles :
 * des zones verticales colorées qui disent, sans lire l'axe du temps, quelle
 * place a formé la bougie qu'on regarde. Une mèche de 30 pips à 3 h du matin
 * et la même à 14 h ne racontent pas la même histoire.
 *
 * ── `zOrder: 'bottom'` n'est pas cosmétique ─────────────────────────────────
 *
 * Les bandes doivent passer **sous** les chandeliers. Dessinées au-dessus,
 * même très transparentes, elles laveraient la couleur des corps — et la
 * couleur des corps est une donnée, pas une décoration.
 *
 * ── Les bornes se recalculent à chaque rendu ────────────────────────────────
 *
 * On ne mémorise pas les bandes : la plage visible change à chaque zoom et à
 * chaque défilement, et une liste mise en cache serait fausse une image sur
 * deux. Le calcul est une poignée de comparaisons d'entiers par séance et par
 * jour visible ; le refaire coûte moins cher que de l'invalider correctement.
 *
 * ── Ce qui n'est pas peint, et pourquoi ─────────────────────────────────────
 *
 * Au-delà de H4, une bougie couvre plusieurs séances : la bande ne désignerait
 * plus rien. Le week-end n'est pas peint non plus — une bande sur un samedi
 * laisserait croire que le marché cotait.
 */

/** En dessous, l'étiquette ne tiendrait pas : on peint la bande sans la nommer. */
const LARGEUR_MINIMUM_ETIQUETTE = 44;

interface Contexte {
  readonly echelleTemps: ITimeScaleApi<Time>;
}

class RenduSeances implements IPrimitivePaneRenderer {
  constructor(
    private readonly bandes: readonly BandeSeance[],
    private readonly contexte: Contexte | null,
    private readonly etiquettes: boolean,
  ) {}

  draw(cible: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const contexte = this.contexte;
    if (!contexte || this.bandes.length === 0) return;

    cible.useBitmapCoordinateSpace((portee) => {
      const ctx = portee.context;
      const ratioX = portee.horizontalPixelRatio;
      const ratioY = portee.verticalPixelRatio;
      const hauteur = portee.bitmapSize.height;

      ctx.save();

      for (const bande of this.bandes) {
        const gauche = contexte.echelleTemps.timeToCoordinate(bande.debut as UTCTimestamp);
        const droite = contexte.echelleTemps.timeToCoordinate(bande.fin as UTCTimestamp);
        // Une borne hors de la plage cotée n'a pas de coordonnée : la
        // bibliothèque rend `null` plutôt que d'extrapoler, et extrapoler
        // nous-mêmes peindrait une bande là où il n'y a pas de bougie.
        if (gauche === null || droite === null) continue;

        const x = Math.round(gauche * ratioX);
        const largeur = Math.round((droite - gauche) * ratioX);
        if (largeur <= 0) continue;

        ctx.fillStyle = COULEURS_BANDES[bande.code];
        ctx.fillRect(x, 0, largeur, hauteur);

        if (this.etiquettes && largeur >= LARGEUR_MINIMUM_ETIQUETTE * ratioX) {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
          ctx.font = `${Math.round(9 * ratioY)}px ui-monospace, monospace`;
          ctx.textBaseline = 'top';
          ctx.fillText(nomSeance(bande.code), x + 4 * ratioX, 3 * ratioY);
        }
      }

      ctx.restore();
    });
  }
}

class VueSeances implements IPrimitivePaneView {
  constructor(private readonly primitive: PrimitiveSeances) {}

  /** Sous les chandeliers, toujours. Voir l'en-tête du fichier. */
  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    const etat = this.primitive.lireEtat();
    return new RenduSeances(etat.bandes, etat.contexte, etat.etiquettes);
  }
}

export class PrimitiveSeances implements ISeriesPrimitive<Time> {
  private contexte: Contexte | null = null;
  private intervalle: Intervalle = 'M5';
  private visible = true;
  private etiquettes = true;
  private demanderRendu: (() => void) | null = null;
  private readonly vue = new VueSeances(this);

  attached(parametres: SeriesAttachedParameter<Time>): void {
    this.contexte = { echelleTemps: parametres.chart.timeScale() };
    this.demanderRendu = parametres.requestUpdate;
  }

  detached(): void {
    this.contexte = null;
    this.demanderRendu = null;
  }

  definirIntervalle(intervalle: Intervalle): void {
    this.intervalle = intervalle;
    this.demanderRendu?.();
  }

  definirVisible(visible: boolean): void {
    this.visible = visible;
    this.demanderRendu?.();
  }

  definirEtiquettes(etiquettes: boolean): void {
    this.etiquettes = etiquettes;
    this.demanderRendu?.();
  }

  lireEtat(): {
    bandes: readonly BandeSeance[];
    contexte: Contexte | null;
    etiquettes: boolean;
  } {
    if (!this.visible || !this.contexte || !bandesPertinentes(this.intervalle)) {
      return { bandes: [], contexte: this.contexte, etiquettes: this.etiquettes };
    }

    const plage = this.contexte.echelleTemps.getVisibleRange();
    if (!plage) return { bandes: [], contexte: this.contexte, etiquettes: this.etiquettes };

    return {
      bandes: bandesSeances(Number(plage.from), Number(plage.to)),
      contexte: this.contexte,
      etiquettes: this.etiquettes,
    };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.vue];
  }
}
