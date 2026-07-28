import { Decimal } from '@/lib/decimal';
import { deriveLimits } from '@/lib/portfolioMath';
import type { RiskContext, RiskDecision, RiskModule, TargetPosition } from '../interfaces';

/** Une heure, en secondes. Fenêtre du contrôle de cadence. */
const HEURE = 3_600;

/**
 * Contrôles de risque standard, appliqués dans l'ordre du plus fatal au plus
 * anodin.
 *
 * L'ordre compte : un compte en repli maximal ne doit pas recevoir « taille
 * réduite à la quotité », il doit recevoir « on arrête ». Le premier motif
 * rendu est celui que l'utilisateur lira, et c'est celui qui doit compter.
 *
 * Chaque refus porte un motif lisible. « Ordre refusé » sans explication
 * conduit à désactiver le contrôle qui protégeait.
 */
export class StandardRisk implements RiskModule {
  readonly id = 'standard';

  vet(target: TargetPosition, ctx: RiskContext): RiskDecision {
    const limites = deriveLimits(ctx.config);

    // 1. Repli depuis le sommet — le plus grave : on ne dose plus, on s'arrête.
    if (!limites.drawdownLimit.estZero()) {
      const repli = ctx.peakEquity.moins(ctx.equity);
      if (repli.plusGrandQue(limites.drawdownLimit) || repli.egal(limites.drawdownLimit)) {
        return {
          kind: 'reject',
          reason: `Repli de ${repli.versTexte(2)} atteint la limite de ${limites.drawdownLimit.versTexte(2)}`,
        };
      }
    }

    // 2. Perte du jour.
    if (!limites.dailyLossLimit.estZero() && ctx.dailyLoss.plusGrandQue(Decimal.ZERO)) {
      if (
        ctx.dailyLoss.plusGrandQue(limites.dailyLossLimit) ||
        ctx.dailyLoss.egal(limites.dailyLossLimit)
      ) {
        return {
          kind: 'reject',
          reason: `Perte du jour de ${ctx.dailyLoss.versTexte(2)} atteint la limite de ${limites.dailyLossLimit.versTexte(2)}`,
        };
      }
    }

    // 3. Nombre de positions ouvertes. Une position de plus sur le même
    //    symbole compte quand même : c'est une exposition de plus.
    if (ctx.positions.length >= ctx.config.maxOpenPositions) {
      return {
        kind: 'reject',
        reason: `${ctx.positions.length} positions ouvertes, maximum ${ctx.config.maxOpenPositions}`,
      };
    }

    // 4. Cadence. Sans ce garde-fou, une stratégie qui oscille peut brûler
    //    l'enveloppe en frais sans jamais perdre sur le prix.
    const recents = ctx.recentOrderTimes.filter((instant) => instant > ctx.now - HEURE);
    if (recents.length >= ctx.config.maxTradesPerHour) {
      return {
        kind: 'reject',
        reason: `${recents.length} ordres dans l'heure, maximum ${ctx.config.maxTradesPerHour}`,
      };
    }

    // 5. Enveloppe globale : la somme des expositions ne dépasse pas ce qui a
    //    été confié à l'IA. Cinq positions au plafond individuel pourraient
    //    sinon engager cinq fois l'enveloppe.
    const exposition = Decimal.somme(
      ctx.positions.map((position) => position.quantity.fois(position.entryPrice)),
    );
    const restant = limites.aiCapital.moins(exposition);
    if (restant.estNegatif() || restant.estZero()) {
      return {
        kind: 'reject',
        reason: `Enveloppe de ${limites.aiCapital.versTexte(2)} déjà engagée`,
      };
    }

    // 6. Plafond par trade — le seul contrôle qui réduit au lieu de refuser :
    //    une position plus petite reste une position valable.
    const plafond = Decimal.min(limites.maxTradeValue, restant);
    if (target.notional.plusGrandQue(plafond)) {
      const reduite = reduireA(target, plafond);
      if (!reduite) {
        return {
          kind: 'reject',
          reason: `Plafond de ${plafond.versTexte(2)} trop bas pour une seule quotité`,
        };
      }
      return {
        kind: 'reduce',
        target: reduite,
        reason: `Taille ramenée au plafond de ${plafond.versTexte(2)}`,
      };
    }

    return { kind: 'approve', target };
  }
}

/**
 * Ramène une intention sous un plafond, en conservant sa quotité.
 *
 * Rend `null` si même une quotité dépasse le plafond : mieux vaut ne pas
 * entrer que d'entrer au-dessus de la limite en arrondissant vers le haut.
 */
function reduireA(target: TargetPosition, plafond: Decimal): TargetPosition | null {
  if (target.quantity.estZero()) return null;
  const prix = target.notional.divisePar(target.quantity, 'PROCHE');
  if (prix.estZero()) return null;

  // Quantité recalculée depuis le plafond, puis descendue à la quotité :
  // arrondir au plus proche repasserait au-dessus de la limite qu'on vient
  // d'appliquer, et un plafond franchissable par arrondi n'en est pas un.
  const quantite = plafond.divisePar(prix, 'BAS').auPas(target.lotStep, 'BAS');
  if (quantite.estZero()) return null;

  const notionnel = quantite.fois(prix);
  if (notionnel.plusGrandQue(plafond)) return null;

  return { ...target, quantity: quantite, notional: notionnel };
}
