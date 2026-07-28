import type { Bar } from '@/types/market';

/**
 * Indicateurs incrémentaux.
 *
 * Incrémentaux et non recalculés : sur quinze ans de bougies horaires, refaire
 * la moyenne complète à chaque pas transforme un backtest de deux secondes en
 * backtest de dix minutes sur une tablette.
 *
 * Chaque indicateur expose `ready` : tant qu'il est faux, `value` ne veut rien
 * dire et la stratégie n'a pas le droit de s'en servir. Une EMA « établie » dès
 * la première bougie vaut simplement ce premier prix, et croiser deux valeurs
 * pareilles fabrique des signaux qui n'existent pas.
 *
 * Ils travaillent en `number`, pas en `Decimal` : ce sont des statistiques sur
 * des prix, pas des montants d'argent. L'exactitude au centime est requise sur
 * un solde, pas sur une moyenne mobile.
 */

export interface Indicator<T = number> {
  readonly ready: boolean;
  readonly value: T;
  update(bar: Bar): T;
  reset(): void;
}

/** Moyenne mobile simple. */
export class SMA implements Indicator {
  private readonly fenetre: number[] = [];
  private somme = 0;

  constructor(readonly period: number) {
    if (period < 1) throw new Error('SMA : période ≥ 1');
  }

  get ready(): boolean {
    return this.fenetre.length === this.period;
  }

  get value(): number {
    return this.fenetre.length === 0 ? 0 : this.somme / this.fenetre.length;
  }

  update(bar: Bar): number {
    this.fenetre.push(bar.close);
    this.somme += bar.close;
    if (this.fenetre.length > this.period) {
      this.somme -= this.fenetre.shift() ?? 0;
    }
    return this.value;
  }

  reset(): void {
    this.fenetre.length = 0;
    this.somme = 0;
  }
}

/**
 * Moyenne mobile exponentielle.
 *
 * Amorcée par une SMA sur la première période, pas par le premier prix : partir
 * d'un seul point donne à cette bougie un poids qui met des dizaines de
 * périodes à s'estomper, et décale tous les croisements du début de série.
 */
export class EMA implements Indicator {
  private readonly amorce: SMA;
  private courant = 0;
  private etabli = false;

  private readonly k: number;

  constructor(readonly period: number) {
    if (period < 1) throw new Error('EMA : période ≥ 1');
    this.k = 2 / (period + 1);
    this.amorce = new SMA(period);
  }

  get ready(): boolean {
    return this.etabli;
  }

  get value(): number {
    return this.courant;
  }

  update(bar: Bar): number {
    if (!this.etabli) {
      this.amorce.update(bar);
      if (this.amorce.ready) {
        this.courant = this.amorce.value;
        this.etabli = true;
      }
      return this.courant;
    }

    this.courant = bar.close * this.k + this.courant * (1 - this.k);
    return this.courant;
  }

  reset(): void {
    this.amorce.reset();
    this.courant = 0;
    this.etabli = false;
  }
}

/**
 * Average True Range, lissage de Wilder.
 *
 * Le « vrai » range inclut l'écart avec la clôture précédente : sans lui, un
 * marché qui ouvre en trou paraîtrait calme alors qu'il vient de sauter.
 */
export class ATR implements Indicator {
  private precedente: Bar | undefined;
  private readonly amorce: number[] = [];
  private courant = 0;
  private etabli = false;

  constructor(readonly period: number) {
    if (period < 1) throw new Error('ATR : période ≥ 1');
  }

  get ready(): boolean {
    return this.etabli;
  }

  get value(): number {
    return this.courant;
  }

  update(bar: Bar): number {
    const tr = this.precedente
      ? Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - this.precedente.close),
          Math.abs(bar.low - this.precedente.close),
        )
      : bar.high - bar.low;
    this.precedente = bar;

    if (!this.etabli) {
      this.amorce.push(tr);
      if (this.amorce.length === this.period) {
        this.courant = this.amorce.reduce((a, b) => a + b, 0) / this.period;
        this.etabli = true;
      }
      return this.courant;
    }

    this.courant = (this.courant * (this.period - 1) + tr) / this.period;
    return this.courant;
  }

  reset(): void {
    this.precedente = undefined;
    this.amorce.length = 0;
    this.courant = 0;
    this.etabli = false;
  }
}

/** Relative Strength Index, lissage de Wilder. */
export class RSI implements Indicator {
  private precedent: number | undefined;
  private gains = 0;
  private pertes = 0;
  private compte = 0;
  private etabli = false;
  private courant = 50;

  constructor(readonly period: number) {
    if (period < 1) throw new Error('RSI : période ≥ 1');
  }

  get ready(): boolean {
    return this.etabli;
  }

  get value(): number {
    return this.courant;
  }

  update(bar: Bar): number {
    const precedent = this.precedent;
    this.precedent = bar.close;
    if (precedent === undefined) return this.courant;

    const variation = bar.close - precedent;
    const gain = Math.max(variation, 0);
    const perte = Math.max(-variation, 0);

    if (!this.etabli) {
      this.gains += gain;
      this.pertes += perte;
      this.compte += 1;
      if (this.compte === this.period) {
        this.gains /= this.period;
        this.pertes /= this.period;
        this.etabli = true;
        this.courant = calculerRsi(this.gains, this.pertes);
      }
      return this.courant;
    }

    this.gains = (this.gains * (this.period - 1) + gain) / this.period;
    this.pertes = (this.pertes * (this.period - 1) + perte) / this.period;
    this.courant = calculerRsi(this.gains, this.pertes);
    return this.courant;
  }

  reset(): void {
    this.precedent = undefined;
    this.gains = 0;
    this.pertes = 0;
    this.compte = 0;
    this.etabli = false;
    this.courant = 50;
  }
}

/** Sans perte, le RSI vaut 100 : la division serait infinie, pas indéfinie. */
function calculerRsi(gains: number, pertes: number): number {
  if (pertes === 0) return gains === 0 ? 50 : 100;
  const rs = gains / pertes;
  return 100 - 100 / (1 + rs);
}
