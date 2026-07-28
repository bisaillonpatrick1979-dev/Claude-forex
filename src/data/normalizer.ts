import type { Bar, Timeframe } from '@/types/market';
import { TIMEFRAME_SECONDS } from '@/types/market';

/**
 * Normalisation des séries.
 *
 * Tout ce qui sort d'un adaptateur passe par ici. Trois invariants sont
 * garantis en sortie, et le moteur en dépend :
 *
 *   1. tri chronologique strict ;
 *   2. aucun doublon d'horodatage ;
 *   3. aucune bougie incohérente (haut < bas, valeur non finie).
 *
 * Une bougie douteuse est **écartée**, jamais réparée. Deviner une valeur
 * manquante revient à inventer un prix, et un prix inventé se propage ensuite
 * dans les indicateurs, les signaux et les métriques sans laisser de trace.
 */

export interface NormalizeReport {
  readonly kept: number;
  readonly droppedInvalid: number;
  readonly droppedDuplicate: number;
  readonly droppedUnaligned: number;
}

export interface NormalizeResult {
  readonly bars: readonly Bar[];
  readonly report: NormalizeReport;
}

/** Une bougie est-elle interne­ment cohérente ? */
export function isValidBar(bar: Bar): boolean {
  const nombres = [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume];
  if (!nombres.every((n) => Number.isFinite(n))) return false;
  if (bar.time <= 0) return false;
  if (bar.volume < 0) return false;
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) return false;

  // Le haut doit dominer l'ouverture et la clôture, le bas les dominer par en
  // dessous. Un fournisseur qui inverse deux colonnes se trahit ici.
  if (bar.high < bar.low) return false;
  if (bar.high < Math.max(bar.open, bar.close)) return false;
  if (bar.low > Math.min(bar.open, bar.close)) return false;

  return true;
}

/**
 * Trie, déduplique et filtre.
 *
 * En cas de doublon d'horodatage, on garde la **dernière** occurrence : une
 * réémission corrige généralement la précédente, c'est la convention de
 * Binance comme de Kraken.
 *
 * L'alignement sur le pas de l'unité de temps est vérifié quand
 * `enforceAlignment` est vrai. Une bougie horaire à 10 h 03 signale un
 * décalage de fuseau chez le fournisseur, et la laisser passer désynchroniserait
 * toute la série.
 */
export function normalizeBars(
  raw: readonly Bar[],
  timeframe: Timeframe,
  enforceAlignment = true,
): NormalizeResult {
  const pas = TIMEFRAME_SECONDS[timeframe];

  let droppedInvalid = 0;
  let droppedUnaligned = 0;

  const parTemps = new Map<number, Bar>();

  for (const bar of raw) {
    if (!isValidBar(bar)) {
      droppedInvalid += 1;
      continue;
    }
    if (enforceAlignment && bar.time % pas !== 0) {
      droppedUnaligned += 1;
      continue;
    }
    parTemps.set(bar.time, bar);
  }

  const bars = [...parTemps.values()].sort((a, b) => a.time - b.time);
  const droppedDuplicate = raw.length - droppedInvalid - droppedUnaligned - bars.length;

  return {
    bars,
    report: { kept: bars.length, droppedInvalid, droppedDuplicate, droppedUnaligned },
  };
}

/**
 * Bougies manquantes dans une série déjà normalisée.
 *
 * On ne les comble pas : un marché fermé n'a pas de prix, et fabriquer une
 * bougie plate ferait croire à une séance calme là où il n'y avait pas de
 * séance du tout. La liste sert à afficher la qualité de la couverture.
 */
export function findGaps(
  bars: readonly Bar[],
  timeframe: Timeframe,
): readonly { from: number; to: number; missing: number }[] {
  const pas = TIMEFRAME_SECONDS[timeframe];
  const trous: { from: number; to: number; missing: number }[] = [];

  for (let i = 1; i < bars.length; i += 1) {
    const precedente = bars[i - 1];
    const courante = bars[i];
    if (!precedente || !courante) continue;

    const ecart = courante.time - precedente.time;
    if (ecart > pas) {
      trous.push({
        from: precedente.time + pas,
        to: courante.time - pas,
        missing: Math.round(ecart / pas) - 1,
      });
    }
  }

  return trous;
}

/** Retire la dernière bougie si elle est encore en formation.
 *
 *  ═══ Barrière anti-look-ahead, côté données ═══
 *  Une bougie dont la période n'est pas écoulée verra encore son haut, son bas
 *  et sa clôture bouger. La donner au moteur reviendrait à lui montrer un prix
 *  qui n'existe pas encore. */
export function dropForming(
  bars: readonly Bar[],
  timeframe: Timeframe,
  now: number = Math.floor(Date.now() / 1000),
): readonly Bar[] {
  const pas = TIMEFRAME_SECONDS[timeframe];
  return bars.filter((bar) => bar.time + pas <= now);
}
