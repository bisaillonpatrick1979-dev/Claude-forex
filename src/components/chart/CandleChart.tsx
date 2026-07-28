import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import type { Bar } from '@/types/market';

/**
 * Graphique en chandeliers, avec son volume dans un panneau séparé.
 *
 * Deux points d'API à ne pas confondre. lightweight-charts v5 a supprimé
 * `addCandlestickSeries()` : on passe désormais par
 * `addSeries(CandlestickSeries, options, paneIndex)`. Le troisième argument est
 * ce qui met le volume dans son propre panneau plutôt que superposé aux prix,
 * où il écrase l'échelle.
 *
 * Le graphique est créé **une seule fois**. Les mises à jour passent par
 * `setData` sur les séries existantes — recréer le graphique à chaque rendu
 * ferait perdre le zoom et la position de l'utilisateur à chaque bougie.
 */
export function CandleChart({
  bars,
  decimals = 2,
  height = 320,
}: {
  bars: readonly Bar[];
  decimals?: number;
  height?: number;
}) {
  const conteneurRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bougiesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  /** Vrai tant qu'on n'a pas encore cadré la vue sur les données. */
  const premierRenduRef = useRef(true);

  useEffect(() => {
    const conteneur = conteneurRef.current;
    if (!conteneur) return;

    const chart = createChart(conteneur, {
      layout: {
        background: { color: '#131A26' },
        textColor: '#94A3B8',
        attributionLogo: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      rightPriceScale: { borderColor: '#1F2937' },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      // Sur tactile, le défilement à un doigt doit déplacer le graphique, pas
      // la page : sans ça, viser une bougie devient un jeu d'adresse.
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { pinch: true, axisPressedMouseMove: false },
      autoSize: true,
    });

    const bougies = chart.addSeries(CandlestickSeries, {
      upColor: '#26A69A',
      downColor: '#EF5350',
      borderUpColor: '#26A69A',
      borderDownColor: '#EF5350',
      wickUpColor: '#26A69A',
      wickDownColor: '#EF5350',
      priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals },
    });

    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceScaleId: '' },
      1,
    );

    // Le panneau du volume prend un sixième de la hauteur : assez pour lire une
    // divergence, pas assez pour voler la place aux prix.
    chart.panes()[1]?.setHeight(Math.max(40, Math.round(height * 0.18)));

    chartRef.current = chart;
    bougiesRef.current = bougies;
    volumeRef.current = volume;
    premierRenduRef.current = true;

    return () => {
      chart.remove();
      chartRef.current = null;
      bougiesRef.current = null;
      volumeRef.current = null;
    };
  }, [decimals, height]);

  useEffect(() => {
    const bougies = bougiesRef.current;
    const volume = volumeRef.current;
    if (!bougies || !volume) return;

    bougies.setData(bars.map(versChandelier));
    volume.setData(bars.map(versVolume));

    // On ne recadre qu'au premier chargement : le faire à chaque mise à jour
    // annulerait le zoom que l'utilisateur vient de poser.
    if (premierRenduRef.current && bars.length > 0) {
      chartRef.current?.timeScale().fitContent();
      premierRenduRef.current = false;
    }
  }, [bars]);

  return <div ref={conteneurRef} style={{ height }} className="w-full" />;
}

const versChandelier = (bar: Bar): CandlestickData<Time> => ({
  time: bar.time as UTCTimestamp,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
});

const versVolume = (bar: Bar): HistogramData<Time> => ({
  time: bar.time as UTCTimestamp,
  value: bar.volume,
  // Teinté par le sens de la bougie, en transparence : le volume informe, il
  // ne doit pas concurrencer les prix du regard.
  color: bar.close >= bar.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
});
