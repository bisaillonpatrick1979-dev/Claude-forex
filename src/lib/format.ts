/**
 * Formatage des nombres affichés.
 *
 * `null` et `undefined` ne sont jamais remplacés par 0 : une donnée absente
 * s'affiche « — ». Un zéro inventé se confond avec un zéro mesuré, et c'est
 * exactement ce qu'on veut éviter dans une interface de trading.
 */

const ABSENT = '—';

export function formaterMonnaie(valeur: number | null | undefined, devise = 'USD'): string {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return ABSENT;
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: devise,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valeur);
}

export function formaterPourcentage(valeur: number | null | undefined, decimales = 2): string {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return ABSENT;
  return `${valeur >= 0 ? '+' : ''}${valeur.toFixed(decimales)} %`;
}

export function formaterNombre(valeur: number | null | undefined, decimales = 2): string {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return ABSENT;
  return new Intl.NumberFormat('fr-CA', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valeur);
}

/** Classe de couleur du P&L. Neutre à zéro : le gris signale « rien encore ». */
export function couleurPnl(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined || valeur === 0) return 'text-texte-attenue';
  return valeur > 0 ? 'text-hausse' : 'text-baisse';
}

/** Convertit un numeric PostgreSQL (renvoyé en chaîne) en nombre, sans
 *  fabriquer de valeur quand la colonne est nulle. */
export function versNombre(valeur: string | number | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const nombre = typeof valeur === 'number' ? valeur : Number.parseFloat(valeur);
  return Number.isFinite(nombre) ? nombre : null;
}
