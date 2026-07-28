import type { Currency } from '@/types/portfolio';
import type { Lang } from '@/i18n';

/**
 * Mise en forme des montants et des pourcentages.
 *
 * Un montant est toujours affiché avec sa devise. « 1 250 » ne dit pas si le
 * portefeuille vaut mille deux cent cinquante dollars canadiens ou américains,
 * et la différence n'est pas cosmétique.
 *
 * Une valeur absente s'affiche comme absente, jamais comme zéro : une position
 * à l'équilibre et une position non évaluable ne sont pas la même chose.
 */

const LOCALES: Readonly<Record<Lang, string>> = { en: 'en-CA', fr: 'fr-CA' };

export function formatMoney(
  value: number | null | undefined,
  currency: Currency,
  lang: Lang = 'en',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(LOCALES[lang], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  lang: Lang = 'en',
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const signe = value > 0 ? '+' : '';
  return `${signe}${new Intl.NumberFormat(LOCALES[lang], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)} %`;
}

export function formatNumber(
  value: number | null | undefined,
  lang: Lang = 'en',
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(LOCALES[lang], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Classe de couleur d'un résultat. Le vert et le rouge sont réservés à ça. */
export function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'text-texte-doux';
  return value > 0 ? 'text-hausse' : 'text-baisse';
}
