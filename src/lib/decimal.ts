/**
 * Arithmétique décimale exacte, sans flottant.
 *
 * Pourquoi ce fichier existe. `0.1 + 0.2` vaut `0.30000000000000004` en
 * IEEE-754. Sur un trade, l'écart est invisible ; sur dix mille trades
 * enchaînés — chacun ajoutant frais, slippage et P&L au solde — la dérive
 * devient un chiffre qu'on ne sait plus expliquer. Un backtest dont le solde
 * final dépend de l'ordre des additions ne mesure plus une stratégie.
 *
 * Représentation retenue : un `bigint` de mantisse et une échelle fixe. Toutes
 * les valeurs partagent la même échelle, ce qui rend l'addition et la
 * comparaison triviales et exactes.
 *
 * Pourquoi 8 décimales et non 2. Le prompt parle d'« entiers en cents », ce qui
 * suffit pour un montant en dollars mais pas pour une quantité de crypto :
 * 0,00042 BTC serait arrondi à zéro. Huit décimales couvrent le satoshi, qui
 * est la plus petite unité qu'on ait à manipuler ici, et restent très loin des
 * limites du `bigint`.
 *
 * Ce que ce module ne fait pas : il ne cache pas les arrondis. Toute division
 * exige un mode d'arrondi explicite, parce qu'il n'existe pas de bon choix par
 * défaut — arrondir une taille de position vers le haut fait dépasser un
 * plafond de risque, l'arrondir vers le bas ne le fait jamais.
 */

/** Nombre de décimales conservées. Le satoshi vaut 1e-8 BTC. */
export const ECHELLE = 8;

const FACTEUR = 10n ** BigInt(ECHELLE);

export type ModeArrondi = 'BAS' | 'HAUT' | 'ZERO' | 'PROCHE';

export class Decimal {
  /** Mantisse : la valeur réelle multipliée par 10^ECHELLE. */
  private readonly brut: bigint;

  private constructor(brut: bigint) {
    this.brut = brut;
  }

  // ── Construction ────────────────────────────────────────────────────────

  static readonly ZERO = new Decimal(0n);
  static readonly UN = new Decimal(FACTEUR);

  /**
   * Depuis un nombre JavaScript.
   *
   * Passe par la représentation textuelle plutôt que par une multiplication :
   * `0.07 * 1e8` donne 7000000.000000001, donc un arrondi de plus dès la
   * construction. Le texte, lui, dit exactement ce que l'auteur a écrit.
   */
  static de(valeur: number | string | bigint): Decimal {
    if (typeof valeur === 'bigint') return new Decimal(valeur * FACTEUR);

    const texte = typeof valeur === 'number' ? nombreVersTexte(valeur) : valeur.trim();
    return Decimal.depuisTexte(texte);
  }

  private static depuisTexte(texte: string): Decimal {
    const correspondance = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(texte);
    if (!correspondance || (correspondance[2] === '' && (correspondance[3] ?? '') === '')) {
      throw new Error(`Nombre décimal illisible : « ${texte} »`);
    }

    const signe = correspondance[1] === '-' ? -1n : 1n;
    const entiere = correspondance[2] === '' ? '0' : (correspondance[2] as string);
    const fraction = correspondance[3] ?? '';

    // Tronqué et non arrondi : une valeur écrite avec plus de huit décimales
    // est une erreur d'unité, pas une précision à préserver silencieusement.
    const fractionCadree = fraction.slice(0, ECHELLE).padEnd(ECHELLE, '0');

    return new Decimal(signe * (BigInt(entiere) * FACTEUR + BigInt(fractionCadree || '0')));
  }

  /** Depuis une mantisse déjà mise à l'échelle — pour la relecture d'un stockage. */
  static depuisBrut(brut: bigint): Decimal {
    return new Decimal(brut);
  }

  get mantisse(): bigint {
    return this.brut;
  }

  // ── Opérations ──────────────────────────────────────────────────────────

  plus(autre: Decimal): Decimal {
    return new Decimal(this.brut + autre.brut);
  }

  moins(autre: Decimal): Decimal {
    return new Decimal(this.brut - autre.brut);
  }

  /**
   * Multiplication. Le produit de deux valeurs à l'échelle 10^8 est à
   * l'échelle 10^16 : il faut redescendre, et cette division tronque vers
   * zéro. C'est le seul arrondi implicite du module, et il est symétrique —
   * il ne favorise donc jamais le trader.
   */
  fois(autre: Decimal): Decimal {
    return new Decimal(tronquerVersZero(this.brut * autre.brut, FACTEUR));
  }

  /** Division avec mode d'arrondi obligatoire. Aucun défaut n'est neutre. */
  divisePar(autre: Decimal, mode: ModeArrondi): Decimal {
    if (autre.brut === 0n) throw new Error('Division par zéro.');
    return new Decimal(diviser(this.brut * FACTEUR, autre.brut, mode));
  }

  /** Pourcentage : `pct(3)` rend 3 % de la valeur. */
  pourcentage(taux: number | string | Decimal): Decimal {
    const t = taux instanceof Decimal ? taux : Decimal.de(taux);
    return this.fois(t).divisePar(Decimal.de(100), 'ZERO');
  }

  /** Points de base : `bps(10)` rend 0,10 % de la valeur. Unité des frais. */
  pointsDeBase(bps: number | string | Decimal): Decimal {
    const b = bps instanceof Decimal ? bps : Decimal.de(bps);
    return this.fois(b).divisePar(Decimal.de(10_000), 'ZERO');
  }

  negatif(): Decimal {
    return new Decimal(-this.brut);
  }

  absolu(): Decimal {
    return this.brut < 0n ? new Decimal(-this.brut) : this;
  }

  /**
   * Ramène à un pas de cotation ou de quantité.
   *
   * Le mode compte : pour une taille de position on descend toujours
   * (`'BAS'`), sinon on franchit le plafond de risque qu'on venait de calculer.
   */
  auPas(pas: Decimal, mode: ModeArrondi = 'BAS'): Decimal {
    if (pas.brut <= 0n) throw new Error('Le pas doit être strictement positif.');
    const quotient = diviser(this.brut, pas.brut, mode);
    return new Decimal(quotient * pas.brut);
  }

  // ── Comparaison ─────────────────────────────────────────────────────────

  compare(autre: Decimal): -1 | 0 | 1 {
    if (this.brut < autre.brut) return -1;
    if (this.brut > autre.brut) return 1;
    return 0;
  }

  egal(autre: Decimal): boolean {
    return this.brut === autre.brut;
  }

  plusPetitQue(autre: Decimal): boolean {
    return this.brut < autre.brut;
  }

  plusGrandQue(autre: Decimal): boolean {
    return this.brut > autre.brut;
  }

  estZero(): boolean {
    return this.brut === 0n;
  }

  estNegatif(): boolean {
    return this.brut < 0n;
  }

  static min(a: Decimal, b: Decimal): Decimal {
    return a.brut <= b.brut ? a : b;
  }

  static max(a: Decimal, b: Decimal): Decimal {
    return a.brut >= b.brut ? a : b;
  }

  static somme(valeurs: readonly Decimal[]): Decimal {
    return valeurs.reduce<Decimal>((total, valeur) => total.plus(valeur), Decimal.ZERO);
  }

  // ── Sortie ──────────────────────────────────────────────────────────────

  /** Texte exact, sans notation scientifique ni perte. */
  versTexte(decimales: number = ECHELLE): string {
    const negatif = this.brut < 0n;
    const absolu = negatif ? -this.brut : this.brut;

    const entiere = absolu / FACTEUR;
    const fraction = (absolu % FACTEUR).toString().padStart(ECHELLE, '0');

    const coupe = Math.max(0, Math.min(decimales, ECHELLE));
    const suffixe = coupe > 0 ? `.${fraction.slice(0, coupe)}` : '';

    return `${negatif ? '-' : ''}${entiere}${suffixe}`;
  }

  /**
   * Conversion vers `number`. Réservée à l'affichage et aux graphiques.
   *
   * Jamais dans un calcul : le retour au flottant réintroduit exactement le
   * problème que ce module existe pour éviter.
   */
  versNombre(): number {
    return Number(this.versTexte());
  }

  toString(): string {
    return this.versTexte();
  }

  toJSON(): string {
    return this.versTexte();
  }
}

// ── Fonctions internes ────────────────────────────────────────────────────

function tronquerVersZero(numerateur: bigint, denominateur: bigint): bigint {
  return numerateur / denominateur;
}

function diviser(numerateur: bigint, denominateur: bigint, mode: ModeArrondi): bigint {
  const quotient = numerateur / denominateur;
  const reste = numerateur % denominateur;
  if (reste === 0n) return quotient;

  const negatif = numerateur < 0n !== denominateur < 0n;

  switch (mode) {
    case 'ZERO':
      return quotient;
    case 'BAS':
      // Vers moins l'infini : la troncature d'un bigint va déjà vers zéro,
      // donc il faut retrancher un cran du côté négatif.
      return negatif ? quotient - 1n : quotient;
    case 'HAUT':
      return negatif ? quotient : quotient + 1n;
    case 'PROCHE': {
      const doubleReste = (reste < 0n ? -reste : reste) * 2n;
      const denominateurAbsolu = denominateur < 0n ? -denominateur : denominateur;
      if (doubleReste < denominateurAbsolu) return quotient;
      return negatif ? quotient - 1n : quotient + 1n;
    }
  }
}

/**
 * Nombre vers texte sans notation scientifique.
 *
 * `(1e-7).toString()` rend « 1e-7 », que l'analyseur de `depuisTexte` refuse.
 * Les petites quantités crypto tombent exactement dans ce cas.
 */
function nombreVersTexte(valeur: number): string {
  if (!Number.isFinite(valeur)) {
    throw new Error(`Valeur non finie : ${valeur}`);
  }
  if (!/e/i.test(String(valeur))) return String(valeur);
  return valeur.toFixed(ECHELLE);
}

/** Raccourci de lecture, très fréquent dans le moteur. */
export function d(valeur: number | string | bigint): Decimal {
  return Decimal.de(valeur);
}
