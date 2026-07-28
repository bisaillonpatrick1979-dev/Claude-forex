import { Decimal, d } from './decimal';
import type { PortfolioConfig } from '@/types/portfolio';

/**
 * Calculs dérivés du portefeuille — fonctions pures, testées.
 *
 * Rien ici ne lit un état global ni l'heure système : tout entre par paramètre.
 * C'est ce qui permet de vérifier au test qu'un plafond fait bien ce qu'il
 * annonce, sans monter une application autour.
 *
 * Le principe qui gouverne tout le fichier : **quand deux limites se
 * rencontrent, la plus stricte gagne**. Un plafond en dollars et un plafond en
 * pourcentage ne se remplacent pas, ils se cumulent — sinon régler l'un
 * annulerait silencieusement l'autre, et l'utilisateur croirait avoir deux
 * protections là où il n'en aurait qu'une.
 */

export const DEFAULT_CONFIG: PortfolioConfig = {
  totalCapital: '100000',
  aiAllocationPct: 10,
  maxTradeAmount: '1000',
  maxTradePct: 2,
  maxOpenPositions: 5,
  maxDailyLossPct: 3,
  maxDrawdownPct: 15,
  maxTradesPerHour: 6,
  // Jamais zéro. Un backtest sans frais ni slippage est un mensonge, et une
  // valeur par défaut nulle est le moyen le plus sûr de produire ce mensonge
  // sans que personne ne l'ait décidé.
  feeBps: 10,
  slippageBps: 5,
  currency: 'CAD',
};

/** Bornes de saisie. Au-delà, ce n'est plus un réglage, c'est une faute de frappe. */
export const LIMITS = {
  aiAllocationPct: { min: 0, max: 100 },
  maxTradePct: { min: 0.1, max: 100 },
  maxOpenPositions: { min: 1, max: 50 },
  maxDailyLossPct: { min: 0.1, max: 100 },
  maxDrawdownPct: { min: 1, max: 100 },
  maxTradesPerHour: { min: 1, max: 240 },
  feeBps: { min: 0, max: 500 },
  slippageBps: { min: 0, max: 500 },
} as const;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Ramène une configuration dans ses bornes. Appelé à chaque écriture. */
export function sanitizeConfig(config: PortfolioConfig): PortfolioConfig {
  const capital = positifOuZero(config.totalCapital);
  return {
    ...config,
    totalCapital: capital.versTexte(2),
    maxTradeAmount: positifOuZero(config.maxTradeAmount).versTexte(2),
    aiAllocationPct: clamp(config.aiAllocationPct, LIMITS.aiAllocationPct.min, LIMITS.aiAllocationPct.max),
    maxTradePct: clamp(config.maxTradePct, LIMITS.maxTradePct.min, LIMITS.maxTradePct.max),
    maxOpenPositions: Math.round(
      clamp(config.maxOpenPositions, LIMITS.maxOpenPositions.min, LIMITS.maxOpenPositions.max),
    ),
    maxDailyLossPct: clamp(config.maxDailyLossPct, LIMITS.maxDailyLossPct.min, LIMITS.maxDailyLossPct.max),
    maxDrawdownPct: clamp(config.maxDrawdownPct, LIMITS.maxDrawdownPct.min, LIMITS.maxDrawdownPct.max),
    maxTradesPerHour: Math.round(
      clamp(config.maxTradesPerHour, LIMITS.maxTradesPerHour.min, LIMITS.maxTradesPerHour.max),
    ),
    feeBps: clamp(config.feeBps, LIMITS.feeBps.min, LIMITS.feeBps.max),
    slippageBps: clamp(config.slippageBps, LIMITS.slippageBps.min, LIMITS.slippageBps.max),
  };
}

function positifOuZero(valeur: string): Decimal {
  try {
    const montant = d(valeur);
    return montant.estNegatif() ? Decimal.ZERO : montant;
  } catch {
    return Decimal.ZERO;
  }
}

export interface DerivedLimits {
  /** Capital total du compte. */
  readonly totalCapital: Decimal;
  /** Part confiée à l'IA. C'est la base de tous ses pourcentages. */
  readonly aiCapital: Decimal;
  /** Plafond par trade issu du pourcentage seul. */
  readonly pctCap: Decimal;
  /** Plafond par trade issu du montant absolu seul. */
  readonly absoluteCap: Decimal;
  /** Le plus strict des deux — celui qui s'applique réellement. */
  readonly maxTradeValue: Decimal;
  /** Perte journalière qui met la firme en pause, en devise. */
  readonly dailyLossLimit: Decimal;
  /** Repli maximal toléré depuis le sommet, en devise. */
  readonly drawdownLimit: Decimal;
  /** Coût aller-retour d'un trade au plafond, frais + slippage. */
  readonly roundTripCost: Decimal;
}

/**
 * Traduit les réglages en limites exploitables.
 *
 * Les pourcentages de l'IA portent sur **son enveloppe**, pas sur le compte
 * entier. Confier 10 000 sur 100 000 puis risquer « 2 % » doit vouloir dire
 * 200, pas 2 000 — c'est la différence entre ce que l'utilisateur croit
 * autoriser et ce qu'il autorise vraiment.
 */
export function deriveLimits(config: PortfolioConfig): DerivedLimits {
  const sain = sanitizeConfig(config);
  const totalCapital = d(sain.totalCapital);
  const aiCapital = totalCapital.pourcentage(sain.aiAllocationPct);

  const pctCap = aiCapital.pourcentage(sain.maxTradePct);
  const absoluteCap = d(sain.maxTradeAmount);
  const maxTradeValue = Decimal.min(pctCap, absoluteCap);

  return {
    totalCapital,
    aiCapital,
    pctCap,
    absoluteCap,
    maxTradeValue,
    dailyLossLimit: aiCapital.pourcentage(sain.maxDailyLossPct),
    drawdownLimit: aiCapital.pourcentage(sain.maxDrawdownPct),
    // Frais et slippage s'appliquent à l'entrée ET à la sortie : d'où le
    // doublement. Ignorer la moitié du coût flatterait chaque backtest.
    roundTripCost: maxTradeValue.pointsDeBase(sain.feeBps + sain.slippageBps).fois(d(2)),
  };
}

/**
 * Avertissements sur une configuration, sans jamais bloquer la saisie.
 *
 * L'utilisateur reste maître de ses réglages. On lui signale ce qui va le
 * gêner — pas pour l'en empêcher, mais pour qu'il ne le découvre pas au
 * moment où une position est refusée sans explication.
 */
export type WarningCode =
  | 'no-ai-capital'
  | 'absolute-cap-binds'
  | 'pct-cap-binds'
  | 'cost-heavy'
  | 'daily-below-trade'
  | 'zero-costs';

export function configWarnings(config: PortfolioConfig): readonly WarningCode[] {
  const limites = deriveLimits(config);
  const avertissements: WarningCode[] = [];

  if (limites.aiCapital.estZero()) avertissements.push('no-ai-capital');

  // Dire lequel des deux plafonds mord : sans ça, régler celui qui ne sert à
  // rien donne l'impression que le réglage est ignoré.
  if (!limites.maxTradeValue.estZero()) {
    if (limites.absoluteCap.plusPetitQue(limites.pctCap)) avertissements.push('absolute-cap-binds');
    else if (limites.pctCap.plusPetitQue(limites.absoluteCap)) avertissements.push('pct-cap-binds');
  }

  if (config.feeBps === 0 && config.slippageBps === 0) avertissements.push('zero-costs');

  // Au-delà de 1 % de la valeur du trade en coûts, il faut un avantage
  // considérable pour seulement rentrer dans ses frais.
  if (
    !limites.maxTradeValue.estZero() &&
    limites.roundTripCost.plusGrandQue(limites.maxTradeValue.pourcentage(1))
  ) {
    avertissements.push('cost-heavy');
  }

  // Une perte journalière plus petite qu'un seul trade rend le plafond
  // atteignable dès la première position perdante.
  if (
    !limites.dailyLossLimit.estZero() &&
    limites.dailyLossLimit.plusPetitQue(limites.maxTradeValue)
  ) {
    avertissements.push('daily-below-trade');
  }

  return avertissements;
}

/** Repli depuis le sommet, en pourcentage. `null` si le sommet est nul. */
export function drawdownPct(equity: Decimal, peak: Decimal): number | null {
  if (peak.estZero() || peak.estNegatif()) return null;
  const repli = peak.moins(equity);
  if (repli.estNegatif()) return 0;
  return repli.divisePar(peak, 'ZERO').fois(d(100)).versNombre();
}
