/**
 * Significativité statistique d'un résultat de backtest.
 *
 * Le problème que ce module traite est le plus coûteux de tout le domaine, et
 * il ne se voit pas : **si on essaie quarante stratégies et qu'on garde la
 * meilleure, on trouvera toujours une gagnante, même sur des données purement
 * aléatoires.** Le Sharpe affiché de la survivante est alors une mesure de
 * chance, pas d'avantage. Elle ne se reproduira pas.
 *
 * Trois outils, du plus simple au plus exigeant :
 *
 *  - le **Sharpe** brut, qui ne corrige rien ;
 *  - le **Sharpe probabiliste** (PSR), qui répond à « quelle probabilité que
 *    le vrai Sharpe dépasse un seuil, compte tenu de la taille de
 *    l'échantillon, de l'asymétrie et des queues épaisses ? » ;
 *  - le **Sharpe dégonflé** (DSR), qui est le PSR dont le seuil est le Sharpe
 *    maximal qu'on obtiendrait *par hasard* en menant N essais. C'est celui
 *    qui compte quand on a comparé plusieurs stratégies.
 *
 * Référence : Bailey & López de Prado, « The Deflated Sharpe Ratio » (2014).
 * L'implémentation suit les formules publiées ; les choix d'estimateur sont
 * documentés au fil du code parce qu'ils changent le résultat.
 *
 * Un avertissement qui vaut pour tout le module : rien ici ne prouve qu'une
 * stratégie marchera. Ces mesures ne font qu'écarter des résultats qui ne
 * prouvent rien. C'est une différence de nature, pas de degré.
 */

/** Constante d'Euler-Mascheroni, requise par l'espérance du maximum. */
const GAMMA_EULER = 0.5772156649015329;

export interface MomentsSerie {
  readonly n: number;
  readonly moyenne: number;
  /** Écart type d'échantillon (dénominateur n − 1). */
  readonly ecartType: number;
  /** Asymétrie. Négative = pertes rares mais violentes. */
  readonly asymetrie: number;
  /** Aplatissement **non centré** : 3 pour une loi normale. */
  readonly aplatissement: number;
}

export function moments(valeurs: readonly number[]): MomentsSerie | null {
  const n = valeurs.length;
  if (n < 2) return null;

  const moyenne = valeurs.reduce((total, valeur) => total + valeur, 0) / n;
  const ecarts = valeurs.map((valeur) => valeur - moyenne);

  const variance = ecarts.reduce((total, ecart) => total + ecart * ecart, 0) / (n - 1);
  const ecartType = Math.sqrt(variance);
  if (!(ecartType > 0)) {
    return { n, moyenne, ecartType: 0, asymetrie: 0, aplatissement: 3 };
  }

  // Moments d'ordre trois et quatre calculés sur l'écart type de population,
  // comme dans la littérature du PSR. Utiliser celui d'échantillon ici
  // décalerait l'aplatissement et donc la correction de queues.
  const sigmaPopulation = Math.sqrt(
    ecarts.reduce((total, ecart) => total + ecart * ecart, 0) / n,
  );

  const asymetrie =
    ecarts.reduce((total, ecart) => total + (ecart / sigmaPopulation) ** 3, 0) / n;
  const aplatissement =
    ecarts.reduce((total, ecart) => total + (ecart / sigmaPopulation) ** 4, 0) / n;

  return { n, moyenne, ecartType, asymetrie, aplatissement };
}

/** Sharpe **par période**, non annualisé. Le PSR raisonne sur celui-ci. */
export function sharpeParPeriode(valeurs: readonly number[]): number | null {
  const m = moments(valeurs);
  if (!m || m.ecartType === 0) return null;
  return m.moyenne / m.ecartType;
}

export interface ResultatPSR {
  /** Probabilité que le vrai Sharpe dépasse la référence, entre 0 et 1. */
  readonly probabilite: number;
  readonly sharpeObserve: number;
  readonly sharpeReference: number;
  readonly n: number;
}

/**
 * Sharpe probabiliste.
 *
 * Un Sharpe de 1,5 sur trente trades ne vaut pas un Sharpe de 1,5 sur mille.
 * Un Sharpe obtenu avec une forte asymétrie négative — beaucoup de petits
 * gains, quelques pertes brutales — vaut moins que le même chiffre obtenu
 * proprement. Le PSR intègre les trois : taille d'échantillon, asymétrie,
 * aplatissement.
 */
export function sharpeProbabiliste(
  valeurs: readonly number[],
  sharpeReference = 0,
): ResultatPSR | null {
  const m = moments(valeurs);
  if (!m || m.ecartType === 0) return null;

  const sharpe = m.moyenne / m.ecartType;

  // Variance asymptotique de l'estimateur du Sharpe. Le terme d'asymétrie
  // pénalise les séries dont les pertes sont rares et fortes ; celui
  // d'aplatissement pénalise les queues épaisses.
  const variance =
    1 - m.asymetrie * sharpe + ((m.aplatissement - 1) / 4) * sharpe * sharpe;

  if (!(variance > 0)) return null;

  const statistique = ((sharpe - sharpeReference) * Math.sqrt(m.n - 1)) / Math.sqrt(variance);

  return {
    probabilite: phi(statistique),
    sharpeObserve: sharpe,
    sharpeReference,
    n: m.n,
  };
}

/**
 * Sharpe maximal attendu **par pur hasard** après N essais indépendants.
 *
 * C'est le seuil qu'il faut battre pour prétendre à autre chose que de la
 * chance. Il croît avec le nombre d'essais : plus on cherche, plus on trouve —
 * même quand il n'y a rien à trouver.
 */
export function sharpeMaximalAttendu(nombreEssais: number, varianceSharpes: number): number {
  const n = Math.max(2, Math.floor(nombreEssais));
  const ecartType = Math.sqrt(Math.max(0, varianceSharpes));
  if (ecartType === 0) return 0;

  const premier = phiInverse(1 - 1 / n);
  const second = phiInverse(1 - 1 / (n * Math.E));

  return ecartType * ((1 - GAMMA_EULER) * premier + GAMMA_EULER * second);
}

export interface ResultatDSR {
  readonly probabilite: number;
  readonly sharpeObserve: number;
  /** Seuil issu du nombre d'essais : le hasard seul l'atteint. */
  readonly seuilHasard: number;
  readonly nombreEssais: number;
  readonly significatif: boolean;
  readonly verdict: string;
}

/** Au-dessus de ce seuil de probabilité, on accepte de parler d'avantage. */
export const SEUIL_SIGNIFICATIVITE = 0.95;

/**
 * Sharpe dégonflé : le seul chiffre honnête quand plusieurs stratégies ont été
 * comparées.
 *
 * `sharpesEssais` doit contenir le Sharpe **de tous les essais menés**, pas
 * seulement des retenus. C'est le point où l'on triche sans le vouloir :
 * oublier les essais ratés revient à sous-estimer le seuil du hasard, et donc
 * à se déclarer significatif à tort.
 */
export function sharpeDeflate(
  rendementsRetenu: readonly number[],
  sharpesEssais: readonly number[],
): ResultatDSR | null {
  const m = moments(rendementsRetenu);
  if (!m || m.ecartType === 0) return null;

  const sharpeObserve = m.moyenne / m.ecartType;
  const nombreEssais = Math.max(1, sharpesEssais.length);

  const varianceEssais = moments(sharpesEssais)?.ecartType ?? 0;
  const seuilHasard =
    nombreEssais > 1 ? sharpeMaximalAttendu(nombreEssais, varianceEssais ** 2) : 0;

  const psr = sharpeProbabiliste(rendementsRetenu, seuilHasard);
  if (!psr) return null;

  const significatif = psr.probabilite >= SEUIL_SIGNIFICATIVITE;

  return {
    probabilite: psr.probabilite,
    sharpeObserve,
    seuilHasard,
    nombreEssais,
    significatif,
    verdict: significatif
      ? `Le résultat survit à la correction pour ${nombreEssais} essai${nombreEssais > 1 ? 's' : ''} : ` +
        `${(psr.probabilite * 100).toFixed(1)} % de probabilité que l'avantage soit réel. À confirmer hors échantillon.`
      : `Après correction pour ${nombreEssais} essai${nombreEssais > 1 ? 's' : ''}, il reste ` +
        `${(psr.probabilite * 100).toFixed(1)} % de probabilité que l'avantage soit réel — sous le seuil de ` +
        `${SEUIL_SIGNIFICATIVITE * 100} %. Ce résultat ne se distingue pas de la chance.`,
  };
}

/**
 * Fonction de répartition de la loi normale centrée réduite.
 *
 * Approximation d'Abramowitz & Stegun 7.1.26 sur `erf`, précise à ~1,5·10⁻⁷.
 * Largement suffisant : on compare à des seuils comme 0,95, pas au dixième de
 * point de base.
 */
export function phi(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const signe = x < 0 ? -1 : 1;
  const absolu = Math.abs(x);

  const t = 1 / (1 + 0.3275911 * absolu);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absolu * absolu);

  return signe * y;
}

/**
 * Quantile de la loi normale centrée réduite (fonction probit).
 *
 * Approximation rationnelle d'Acklam, précise à ~1,15·10⁻⁹ sur l'intervalle
 * utile. Nécessaire au calcul du seuil du hasard, qui évalue Φ⁻¹ très près
 * de 1 — là où une approximation grossière dérive fortement.
 */
export function phiInverse(p: number): number {
  if (!(p > 0) || !(p < 1)) {
    return p <= 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ];

  const basse = 0.02425;
  const haute = 1 - basse;

  if (p < basse) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }

  if (p > haute) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
