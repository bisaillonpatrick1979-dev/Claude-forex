'use client';

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';

import {
  clotures,
  moyenneMobileExponentielle,
  moyenneMobileSimple,
  rsi,
  type Serie,
} from '@/lib/marche/indicateurs';
import { POINTS_REQUIS, type Annotation, type Outil, type PointGraphique } from '@/lib/graphique/annotations';
import type { Chandelier } from '@/lib/marche/types';

import { PrimitiveAnnotations } from './primitive-annotations';
import type { IndicateursActifs, MarqueurDecision } from './types-graphique';

/**
 * Graphique en chandeliers, lightweight-charts v5.
 *
 * API v5 : `addSeries(CandlestickSeries, …)` — `addCandlestickSeries()` a
 * disparu. Les marqueurs passent par la primitive `createSeriesMarkers`, plus
 * par `series.setMarkers()`.
 *
 * Anti-clignotement : le graphique n'est créé qu'une fois, et les données
 * arrivent par `update()` sur les bougies de queue. `setData()` n'est appelé
 * qu'au premier chargement et au changement d'instrument — c'est ce qui permet
 * au graphique de se rafraîchir tout seul sans sauter.
 */

const COULEURS = {
  fond: '#0a0d12',
  grille: '#1a212b',
  texte: '#7b8798',
  hausse: '#22c55e',
  baisse: '#ef4444',
  volumeHausse: 'rgba(34, 197, 94, 0.35)',
  volumeBaisse: 'rgba(239, 68, 68, 0.35)',
  sma20: '#4c9aff',
  sma50: '#c084fc',
  ema20: '#f59e0b',
  rsi: '#38bdf8',
} as const;

interface Proprietes {
  readonly chandeliers: readonly Chandelier[];
  readonly decimales: number;
  readonly indicateurs: IndicateursActifs;
  readonly marqueurs?: readonly MarqueurDecision[];
  readonly cleInstrument: string;
  readonly annotations?: readonly Annotation[];
  /** Outil armé. `null` = le graphique se manipule normalement. */
  readonly outil?: Outil | null;
  readonly couleurOutil?: string;
  /** Appelé quand tous les points requis par l'outil ont été posés. */
  readonly surTracer?: (points: readonly PointGraphique[]) => void;
}

interface InfoSurvol {
  readonly chandelier: Chandelier;
  readonly marqueur: MarqueurDecision | null;
}

export function GraphiqueChandeliers({
  chandeliers,
  decimales,
  indicateurs,
  marqueurs = [],
  cleInstrument,
  annotations = [],
  outil = null,
  couleurOutil = '#4c9aff',
  surTracer,
}: Proprietes) {
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bougiesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlaysRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const marqueursRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const primitiveRef = useRef<PrimitiveAnnotations | null>(null);

  // Points déjà posés pour le tracé en cours. En `ref` et non en état : le
  // gestionnaire de clic est enregistré une seule fois auprès du graphique, et
  // une valeur d'état y serait figée à celle du premier rendu.
  const enCoursRef = useRef<PointGraphique[]>([]);
  const outilRef = useRef<Outil | null>(outil);
  outilRef.current = outil;
  const surTracerRef = useRef(surTracer);
  surTracerRef.current = surTracer;

  const [pointsPoses, setPointsPoses] = useState(0);

  const dernierAppliqueRef = useRef<{ cle: string; horodatage: number } | null>(null);
  const donneesRef = useRef<readonly Chandelier[]>([]);
  const marqueursDonneesRef = useRef<readonly MarqueurDecision[]>([]);

  const [survol, setSurvol] = useState<InfoSurvol | null>(null);

  // --- Création du graphique, une seule fois -------------------------------
  useEffect(() => {
    const conteneur = conteneurRef.current;
    if (!conteneur) return;

    // Capturé maintenant : au moment du nettoyage, `overlaysRef.current`
    // pourrait déjà pointer ailleurs.
    const overlays = overlaysRef.current;

    const chart = createChart(conteneur, {
      layout: {
        background: { type: ColorType.Solid, color: COULEURS.fond },
        textColor: COULEURS.texte,
        fontFamily:
          "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COULEURS.grille },
        horzLines: { color: COULEURS.grille },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: COULEURS.grille },
      timeScale: {
        borderColor: COULEURS.grille,
        timeVisible: true,
        secondsVisible: false,
      },
      localization: { locale: 'fr-CA' },
      autoSize: false,
    });

    chartRef.current = chart;

    bougiesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: COULEURS.hausse,
      downColor: COULEURS.baisse,
      borderUpColor: COULEURS.hausse,
      borderDownColor: COULEURS.baisse,
      wickUpColor: COULEURS.hausse,
      wickDownColor: COULEURS.baisse,
      priceFormat: { type: 'price', precision: decimales, minMove: 10 ** -decimales },
    });

    volumeRef.current = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceScaleId: '' },
      1,
    );

    marqueursRef.current = createSeriesMarkers(bougiesRef.current, []);

    const primitive = new PrimitiveAnnotations();
    bougiesRef.current.attachPrimitive(primitive);
    primitiveRef.current = primitive;

    // Légende OHLC suivant le curseur : indispensable pour lire des valeurs
    // exactes plutôt que de les estimer à l'œil.
    chart.subscribeCrosshairMove((parametres) => {
      const horodatage = parametres.time as UTCTimestamp | undefined;
      if (horodatage === undefined) {
        setSurvol(null);
        return;
      }
      const chandelier = donneesRef.current.find((bougie) => bougie.horodatage === horodatage);
      if (!chandelier) {
        setSurvol(null);
        return;
      }
      const marqueur =
        marqueursDonneesRef.current.find((m) => m.horodatage === horodatage) ?? null;
      setSurvol({ chandelier, marqueur });
    });

    // Pose des points d'un tracé. L'ancrage se fait en prix et en temps, pas en
    // pixels : c'est ce qui fait qu'un trait reste sur son niveau quand on zoome.
    chart.subscribeClick((parametres) => {
      const arme = outilRef.current;
      if (!arme || !parametres.point) return;

      const serie = bougiesRef.current;
      if (!serie) return;

      const prix = serie.coordinateToPrice(parametres.point.y);
      // Un clic dans la marge droite n'a pas de bougie sous le curseur :
      // `param.time` est alors absent, et c'est l'échelle qui donne l'instant.
      const instant =
        (parametres.time as UTCTimestamp | undefined) ??
        (chart.timeScale().coordinateToTime(parametres.point.x) as UTCTimestamp | null);

      if (prix === null || instant === null || instant === undefined) return;

      enCoursRef.current = [...enCoursRef.current, { horodatage: instant, prix }];
      setPointsPoses(enCoursRef.current.length);

      if (enCoursRef.current.length >= POINTS_REQUIS[arme]) {
        const points = enCoursRef.current;
        enCoursRef.current = [];
        setPointsPoses(0);
        surTracerRef.current?.(points);
      }
    });

    const redimensionner = () => {
      const largeur = conteneur.clientWidth;
      const hauteur = conteneur.clientHeight;
      if (largeur === 0 || hauteur === 0) return;
      chart.resize(largeur, hauteur);
      // Le volume occupe une bande basse fixe : lui laisser une part
      // proportionnelle le rendrait illisible sur tablette.
      chart.panes()[1]?.setHeight(Math.max(48, Math.round(hauteur * 0.16)));
    };

    redimensionner();
    const observateur = new ResizeObserver(redimensionner);
    observateur.observe(conteneur);

    return () => {
      observateur.disconnect();
      chart.remove();
      chartRef.current = null;
      bougiesRef.current = null;
      volumeRef.current = null;
      rsiRef.current = null;
      marqueursRef.current = null;
      primitiveRef.current = null;
      overlays.clear();
      dernierAppliqueRef.current = null;
    };
    // Le graphique n'est jamais recréé : les décimales sont réappliquées
    // ci-dessous, et tout le reste est piloté par les effets suivants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bougiesRef.current?.applyOptions({
      priceFormat: { type: 'price', precision: decimales, minMove: 10 ** -decimales },
    });
    primitiveRef.current?.definirDecimales(decimales);
  }, [decimales]);

  useEffect(() => {
    primitiveRef.current?.definirAnnotations(annotations);
  }, [annotations]);

  // Changer d'outil ou l'abandonner annule le tracé en cours : laisser un point
  // orphelin ferait apparaître un trait à moitié posé au clic suivant.
  useEffect(() => {
    enCoursRef.current = [];
    setPointsPoses(0);
  }, [outil, cleInstrument]);

  // Le graphique ne se déplace plus tant qu'un outil est armé : sinon le
  // premier clic pose un point et le glissement qui suit fait défiler l'écran.
  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: outil === null,
      handleScale: outil === null,
    });
  }, [outil]);

  // --- Application des données --------------------------------------------
  useEffect(() => {
    const bougies = bougiesRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!bougies || !volume || !chart || chandeliers.length === 0) return;

    donneesRef.current = chandeliers;
    const precedent = dernierAppliqueRef.current;
    const dernier = chandeliers[chandeliers.length - 1]!;

    if (!precedent || precedent.cle !== cleInstrument) {
      bougies.setData(chandeliers.map(versBougie));
      volume.setData(chandeliers.map(versVolume));
      chart.timeScale().fitContent();
    } else {
      // Seules les bougies au moins aussi récentes que la dernière appliquée
      // peuvent avoir changé : la bougie en formation, et les nouvelles.
      for (const chandelier of chandeliers) {
        if (chandelier.horodatage < precedent.horodatage) continue;
        bougies.update(versBougie(chandelier));
        volume.update(versVolume(chandelier));
      }
    }

    dernierAppliqueRef.current = { cle: cleInstrument, horodatage: dernier.horodatage };
  }, [chandeliers, cleInstrument]);

  // --- Indicateurs superposés ---------------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chandeliers.length === 0) return;

    const prix = clotures(chandeliers);
    const souhaites: { cle: string; couleur: string; serie: Serie }[] = [];

    if (indicateurs.sma20) {
      souhaites.push({ cle: 'sma20', couleur: COULEURS.sma20, serie: moyenneMobileSimple(prix, 20) });
    }
    if (indicateurs.sma50) {
      souhaites.push({ cle: 'sma50', couleur: COULEURS.sma50, serie: moyenneMobileSimple(prix, 50) });
    }
    if (indicateurs.ema20) {
      souhaites.push({
        cle: 'ema20',
        couleur: COULEURS.ema20,
        serie: moyenneMobileExponentielle(prix, 20),
      });
    }

    const overlays = overlaysRef.current;

    for (const [cle, serie] of overlays) {
      if (!souhaites.some((candidat) => candidat.cle === cle)) {
        chart.removeSeries(serie);
        overlays.delete(cle);
      }
    }

    for (const { cle, couleur, serie } of souhaites) {
      let ligne = overlays.get(cle);
      if (!ligne) {
        ligne = chart.addSeries(LineSeries, {
          color: couleur,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        overlays.set(cle, ligne);
      }
      ligne.setData(versLigne(chandeliers, serie));
    }
  }, [chandeliers, indicateurs.sma20, indicateurs.sma50, indicateurs.ema20]);

  // --- RSI dans son propre panneau ----------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!indicateurs.rsi) {
      if (rsiRef.current) {
        chart.removeSeries(rsiRef.current);
        rsiRef.current = null;
      }
      return;
    }

    if (chandeliers.length === 0) return;

    if (!rsiRef.current) {
      rsiRef.current = chart.addSeries(
        LineSeries,
        {
          color: COULEURS.rsi,
          lineWidth: 1,
          priceLineVisible: false,
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 },
            margins: { above: 0, below: 0 },
          }),
        },
        2,
      );

      // Les marges par défaut de l'échelle (20 % en haut, 10 % en bas)
      // élargissent la plage affichée : l'axe montait à 120 alors que le RSI
      // est borné à 100, ce qui décalait visuellement les repères 30 et 70.
      rsiRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });

      // Repères 30 / 70 : le RSI ne se lit pas sans eux.
      for (const niveau of [30, 70]) {
        rsiRef.current.createPriceLine({
          price: niveau,
          color: COULEURS.grille,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        });
      }
      const hauteur = conteneurRef.current?.clientHeight ?? 0;
      chart.panes()[2]?.setHeight(Math.max(48, Math.round(hauteur * 0.16)));
    }

    rsiRef.current.setData(versLigne(chandeliers, rsi(clotures(chandeliers), 14)));
  }, [chandeliers, indicateurs.rsi]);

  // --- Marqueurs de décision ----------------------------------------------
  useEffect(() => {
    marqueursDonneesRef.current = marqueurs;
    marqueursRef.current?.setMarkers(
      marqueurs.map((marqueur) => ({
        time: marqueur.horodatage as UTCTimestamp,
        position: marqueur.position,
        shape: marqueur.forme,
        color: marqueur.couleur,
        text: marqueur.etiquette,
        id: marqueur.id,
      })),
    );
  }, [marqueurs]);

  const restants = outil ? POINTS_REQUIS[outil] - pointsPoses : 0;

  return (
    <div className="relative h-full w-full">
      <div
        ref={conteneurRef}
        className={`h-full w-full ${outil ? 'cursor-crosshair' : ''}`}
        style={outil ? { boxShadow: `inset 0 0 0 1px ${couleurOutil}66` } : undefined}
      />

      {outil ? (
        <div
          className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded border px-2 py-1 text-xs backdrop-blur-sm"
          style={{ borderColor: couleurOutil, color: couleurOutil, background: 'rgba(10,13,18,0.85)' }}
        >
          {restants > 0
            ? `Cliquer ${restants === 1 ? 'un point' : `${restants} points`} sur le graphique`
            : 'Tracé enregistré'}
        </div>
      ) : null}

      {survol ? (
        <div className="pointer-events-none absolute left-2 top-2 rounded border border-bordure bg-panneau/90 px-2 py-1.5 backdrop-blur-sm">
          <div className="chiffre flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <Valeur libelle="O" valeur={survol.chandelier.ouverture} decimales={decimales} />
            <Valeur libelle="H" valeur={survol.chandelier.haut} decimales={decimales} />
            <Valeur libelle="B" valeur={survol.chandelier.bas} decimales={decimales} />
            <Valeur libelle="C" valeur={survol.chandelier.cloture} decimales={decimales} />
            {survol.chandelier.volume !== null ? (
              <span className="text-texte-attenue">
                Vol {Math.round(survol.chandelier.volume).toLocaleString('fr-CA')}
              </span>
            ) : null}
          </div>
          {survol.marqueur ? (
            <p className="mt-1 max-w-72 border-t border-bordure pt-1 text-xs leading-snug text-texte-attenue">
              {survol.marqueur.raisonnement}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Valeur({
  libelle,
  valeur,
  decimales,
}: {
  libelle: string;
  valeur: number;
  decimales: number;
}) {
  return (
    <span>
      <span className="text-texte-attenue">{libelle}</span> {valeur.toFixed(decimales)}
    </span>
  );
}

function versBougie(chandelier: Chandelier) {
  return {
    time: chandelier.horodatage as UTCTimestamp,
    open: chandelier.ouverture,
    high: chandelier.haut,
    low: chandelier.bas,
    close: chandelier.cloture,
  };
}

function versVolume(chandelier: Chandelier) {
  return {
    time: chandelier.horodatage as UTCTimestamp,
    value: chandelier.volume ?? 0,
    color: chandelier.cloture >= chandelier.ouverture ? COULEURS.volumeHausse : COULEURS.volumeBaisse,
  };
}

/**
 * Les positions non définies d'un indicateur sont rendues en « whitespace »
 * (un point sans valeur) plutôt qu'omises : la ligne démarre alors au bon
 * endroit sans décaler l'échelle de temps.
 */
function versLigne(chandeliers: readonly Chandelier[], serie: Serie) {
  return chandeliers.map((chandelier, index) => {
    const valeur = serie[index];
    return valeur === null || valeur === undefined
      ? { time: chandelier.horodatage as UTCTimestamp }
      : { time: chandelier.horodatage as UTCTimestamp, value: valeur };
  });
}
