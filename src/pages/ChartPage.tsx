import { useCallback, useEffect, useMemo, useState } from 'react';

import { CandleChart } from '@/components/chart/CandleChart';
import { ChartControls, DEFAULT_SYMBOLS } from '@/components/chart/ChartControls';
import { EmptyState, Panel } from '@/components/ui/Panel';
import { AdapterError, loadSeries } from '@/data';
import { useT } from '@/i18n';
import { TIMEFRAME_SECONDS, type BarSeries, type Timeframe } from '@/types/market';

/** Bougies demandées à l'ouverture. Assez pour lire une structure, assez peu
 *  pour rester fluide sur une tablette. */
const BOUGIES = 500;

export function ChartPage() {
  const t = useT();
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOLS[0]?.id ?? 'BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [serie, setSerie] = useState<BarSeries | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [compteurRafraichissement, setCompteurRafraichissement] = useState(0);

  const decimales = useMemo(
    () => DEFAULT_SYMBOLS.find((option) => option.id === symbol)?.decimals ?? 2,
    [symbol],
  );

  useEffect(() => {
    // `annule` évite d'afficher la réponse d'une requête abandonnée : changer
    // d'instrument pendant un chargement lent ferait sinon apparaître les
    // bougies du précédent sur le nouveau symbole.
    let annule = false;
    const controleur = new AbortController();

    setEnCours(true);
    setErreur(null);

    const maintenant = Math.floor(Date.now() / 1000);
    const depuis = maintenant - TIMEFRAME_SECONDS[timeframe] * BOUGIES;

    void loadSeries({
      adapterId: 'binance',
      symbol,
      timeframe,
      from: depuis,
      to: maintenant,
      refresh: compteurRafraichissement > 0,
      signal: controleur.signal,
    })
      .then((resultat) => {
        if (!annule) setSerie(resultat);
      })
      .catch((cause: unknown) => {
        if (annule) return;
        setSerie(null);
        setErreur(cause instanceof AdapterError ? cause.message : t.chart.failed);
      })
      .finally(() => {
        if (!annule) setEnCours(false);
      });

    return () => {
      annule = true;
      controleur.abort();
    };
  }, [symbol, timeframe, compteurRafraichissement, t.chart.failed]);

  const rafraichir = useCallback(() => setCompteurRafraichissement((n) => n + 1), []);

  const libelleSource = serie
    ? {
        network: t.chart.sourceNetwork,
        cache: t.chart.sourceCache,
        'stale-cache': t.chart.sourceStale,
        file: t.chart.sourceFile,
      }[serie.source]
    : null;

  return (
    <div className="flex flex-col gap-3">
      <Panel title={t.chart.title}>
        <ChartControls
          symbol={symbol}
          timeframe={timeframe}
          onSymbol={setSymbol}
          onTimeframe={setTimeframe}
          onRefresh={rafraichir}
          busy={enCours}
        />
      </Panel>

      <Panel className="overflow-hidden">
        {erreur ? (
          <EmptyState message={erreur} />
        ) : serie && serie.bars.length > 0 ? (
          <CandleChart bars={serie.bars} decimals={decimales} height={340} />
        ) : (
          <EmptyState message={enCours ? t.chart.loading : t.chart.empty} />
        )}

        {/* D'où viennent les chiffres affichés, toujours visible. Un graphique
            servi depuis un cache périmé doit se signaler comme tel. */}
        <p className="chiffre mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-texte-doux/70">
          {serie ? (
            <>
              <span>
                {serie.bars.length} {t.chart.bars}
              </span>
              <span>·</span>
              <span className={serie.source === 'stale-cache' ? 'text-alerte' : ''}>
                {serie.adapterId} · {libelleSource}
              </span>
              <span>·</span>
            </>
          ) : null}
          {/* Attribution exigée par la licence Apache 2.0 de lightweight-charts. */}
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {t.chart.attribution}
          </a>
        </p>
      </Panel>
    </div>
  );
}
