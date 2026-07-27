import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ITimeScaleApi,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';

import {
  niveauxAnnotation,
  prixTendance,
  type Annotation,
} from '@/lib/graphique/annotations';

/**
 * Rendu des annotations, en primitive lightweight-charts.
 *
 * Pourquoi écrire ça plutôt que d'installer un paquet d'outils de dessin : le
 * seul disponible pour la v5 en compte soixante-huit, mais il en est à sa
 * deuxième version publiée, par un seul auteur, sans historique. Ce code tourne
 * dans la page qui porte la session Supabase du propriétaire de la firme ; six
 * outils écrits ici valent mieux que soixante-huit dont on ne répond pas.
 *
 * L'ancrage est fait en **prix et en temps**, jamais en pixels. Un trait ancré
 * en pixels se décrocherait au premier zoom — et c'est exactement ce qui
 * distingue un outil de dessin d'un gribouillage sur une capture d'écran.
 *
 * Le rendu se fait dans l'espace bitmap : sur un écran à haute densité,
 * dessiner en coordonnées média produit des traits flous d'un demi-pixel, ce
 * qui se voit immédiatement sur une ligne horizontale.
 */

const POINTILLES = [5, 4];

interface Contexte {
  readonly serie: ISeriesApi<SeriesType>;
  readonly echelleTemps: ITimeScaleApi<Time>;
  readonly decimales: number;
  /** Annotation en cours de survol ou de sélection : rendue plus épaisse. */
  readonly selectionnee: string | null;
}

class RenduAnnotations implements IPrimitivePaneRenderer {
  constructor(
    private readonly annotations: readonly Annotation[],
    private readonly contexte: Contexte,
  ) {}

  draw(cible: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    cible.useBitmapCoordinateSpace((portee) => {
      const ctx = portee.context;
      const ratioX = portee.horizontalPixelRatio;
      const ratioY = portee.verticalPixelRatio;
      const largeur = portee.bitmapSize.width;

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.font = `${Math.round(10 * ratioY)}px ui-monospace, Menlo, Consolas, monospace`;

      for (const annotation of this.annotations) {
        const epaisseur = (annotation.id === this.contexte.selectionnee ? 2 : 1) * ratioY;
        ctx.strokeStyle = annotation.couleur;
        ctx.fillStyle = annotation.couleur;
        ctx.lineWidth = epaisseur;
        this.dessiner(ctx, annotation, ratioX, ratioY, largeur);
      }

      ctx.restore();
    });
  }

  private dessiner(
    ctx: CanvasRenderingContext2D,
    annotation: Annotation,
    ratioX: number,
    ratioY: number,
    largeur: number,
  ): void {
    const y = (prix: number) => {
      const coordonnee = this.contexte.serie.priceToCoordinate(prix);
      return coordonnee === null ? null : coordonnee * ratioY;
    };
    const x = (horodatage: number) => {
      const coordonnee = this.contexte.echelleTemps.timeToCoordinate(horodatage as UTCTimestamp);
      return coordonnee === null ? null : coordonnee * ratioX;
    };

    const [a, b] = annotation.points;
    if (!a) return;

    switch (annotation.outil) {
      case 'NIVEAU': {
        const ligne = y(a.prix);
        if (ligne === null) return;
        // Le niveau traverse tout l'écran : le limiter à la portion tracée
        // obligerait à l'étirer chaque fois qu'on défile.
        traitHorizontal(ctx, ligne, largeur);
        etiquette(ctx, `${a.prix.toFixed(this.contexte.decimales)}${suffixe(annotation)}`, 4 * ratioX, ligne - 3 * ratioY, ratioY);
        return;
      }

      case 'TENDANCE': {
        if (!b) return;
        // Prolongée aux deux bords visibles, pas seulement entre les points.
        const gauche = this.contexte.echelleTemps.coordinateToTime(0);
        const droite = this.contexte.echelleTemps.coordinateToTime(largeur / ratioX);
        if (gauche === null || droite === null) return;

        const prixGauche = prixTendance(annotation, gauche as number);
        const prixDroite = prixTendance(annotation, droite as number);
        if (prixGauche === null || prixDroite === null) return;

        const yGauche = y(prixGauche);
        const yDroite = y(prixDroite);
        if (yGauche === null || yDroite === null) return;

        ctx.beginPath();
        ctx.moveTo(0, yGauche);
        ctx.lineTo(largeur, yDroite);
        ctx.stroke();

        // Poignées aux points d'ancrage : sans elles, impossible de savoir où
        // la droite a réellement été posée une fois qu'elle est prolongée.
        for (const point of [a, b]) {
          const px = x(point.horodatage);
          const py = y(point.prix);
          if (px !== null && py !== null) poignee(ctx, px, py, ratioY);
        }
        if (annotation.libelle) {
          const py = y(prixDroite);
          if (py !== null) etiquette(ctx, annotation.libelle, largeur - 6 * ratioX, py - 4 * ratioY, ratioY, 'right');
        }
        return;
      }

      case 'FIBONACCI':
      case 'FIBONACCI_EXTENSION': {
        if (!b) return;
        const niveaux = niveauxAnnotation(annotation);
        const xa = x(a.horodatage);
        const xb = x(b.horodatage);
        const depart = xa === null ? 0 : Math.min(xa, xb ?? xa);

        for (const niveau of niveaux) {
          const ligne = y(niveau.prix);
          if (ligne === null) continue;
          // Les ratios de convention (0, 50 %, 100 %) en pointillé : ils ne
          // dérivent pas de la suite, et l'œil doit pouvoir les distinguer.
          ctx.setLineDash(niveau.conventionnel ? POINTILLES.map((v) => v * ratioY) : []);
          ctx.beginPath();
          ctx.moveTo(depart, ligne);
          ctx.lineTo(largeur, ligne);
          ctx.stroke();
          etiquette(
            ctx,
            `${niveau.libelle}  ${niveau.prix.toFixed(this.contexte.decimales)}`,
            depart + 4 * ratioX,
            ligne - 3 * ratioY,
            ratioY,
          );
        }
        ctx.setLineDash([]);

        // Le segment d'origine, en trait fin : c'est lui qui dit d'où vient le
        // tracé, information perdue dès qu'on ne voit que les horizontales.
        const ya = y(a.prix);
        const yb = y(b.prix);
        if (xa !== null && xb !== null && ya !== null && yb !== null) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.setLineDash(POINTILLES.map((v) => v * ratioY));
          ctx.beginPath();
          ctx.moveTo(xa, ya);
          ctx.lineTo(xb, yb);
          ctx.stroke();
          ctx.restore();
          poignee(ctx, xa, ya, ratioY);
          poignee(ctx, xb, yb, ratioY);
        }
        return;
      }

      case 'ZONE': {
        if (!b) return;
        const haut = y(Math.max(a.prix, b.prix));
        const bas = y(Math.min(a.prix, b.prix));
        if (haut === null || bas === null) return;

        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillRect(0, haut, largeur, bas - haut);
        ctx.restore();

        traitHorizontal(ctx, haut, largeur);
        traitHorizontal(ctx, bas, largeur);
        if (annotation.libelle) etiquette(ctx, annotation.libelle, 4 * ratioX, haut - 3 * ratioY, ratioY);
        return;
      }

      case 'NOTE': {
        const px = x(a.horodatage);
        const py = y(a.prix);
        if (px === null || py === null) return;
        poignee(ctx, px, py, ratioY);
        if (annotation.libelle) etiquette(ctx, annotation.libelle, px + 6 * ratioX, py - 4 * ratioY, ratioY);
        return;
      }
    }
  }
}

class VueAnnotations implements IPrimitivePaneView {
  constructor(private readonly source: PrimitiveAnnotations) {}

  renderer(): IPrimitivePaneRenderer | null {
    const { annotations, contexte } = this.source.lireEtat();
    if (!contexte || annotations.length === 0) return null;
    return new RenduAnnotations(annotations, contexte);
  }
}

export class PrimitiveAnnotations implements ISeriesPrimitive<Time> {
  private annotations: readonly Annotation[] = [];
  private contexte: Contexte | null = null;
  private decimales = 5;
  private selectionnee: string | null = null;
  private demanderRendu: (() => void) | null = null;
  private readonly vue = new VueAnnotations(this);

  attached(parametres: SeriesAttachedParameter<Time>): void {
    this.contexte = {
      serie: parametres.series,
      echelleTemps: parametres.chart.timeScale(),
      decimales: this.decimales,
      selectionnee: this.selectionnee,
    };
    // Sans cette référence, une annotation ajoutée hors d'un mouvement de
    // souris n'apparaîtrait qu'au prochain zoom : la bibliothèque ne redessine
    // que ce qu'elle croit avoir changé.
    this.demanderRendu = parametres.requestUpdate;
  }

  detached(): void {
    this.contexte = null;
    this.demanderRendu = null;
  }

  definirAnnotations(annotations: readonly Annotation[]): void {
    this.annotations = annotations;
    this.demanderRendu?.();
  }

  definirDecimales(decimales: number): void {
    this.decimales = decimales;
    if (this.contexte) this.contexte = { ...this.contexte, decimales };
    this.demanderRendu?.();
  }

  definirSelection(id: string | null): void {
    this.selectionnee = id;
    if (this.contexte) this.contexte = { ...this.contexte, selectionnee: id };
    this.demanderRendu?.();
  }

  lireEtat(): { annotations: readonly Annotation[]; contexte: Contexte | null } {
    return { annotations: this.annotations, contexte: this.contexte };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.vue];
  }
}

function traitHorizontal(ctx: CanvasRenderingContext2D, y: number, largeur: number): void {
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(largeur, y);
  ctx.stroke();
}

function poignee(ctx: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 3 * ratio, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Étiquette posée sur fond opaque.
 *
 * Sans le fond, le texte se confond avec les bougies dès qu'il tombe sur une
 * zone dense — c'est le défaut le plus visible d'une couche de dessin faite à
 * la va-vite.
 */
function etiquette(
  ctx: CanvasRenderingContext2D,
  texte: string,
  x: number,
  y: number,
  ratio: number,
  alignement: 'left' | 'right' = 'left',
): void {
  const marge = 3 * ratio;
  const largeurTexte = ctx.measureText(texte).width;
  const hauteur = 12 * ratio;
  const gauche = alignement === 'right' ? x - largeurTexte - marge * 2 : x;

  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(gauche, y - hauteur, largeurTexte + marge * 2, hauteur + marge);
  ctx.restore();

  ctx.save();
  ctx.textBaseline = 'bottom';
  ctx.fillText(texte, gauche + marge, y);
  ctx.restore();
}

function suffixe(annotation: Annotation): string {
  return annotation.libelle ? `  ${annotation.libelle}` : '';
}
