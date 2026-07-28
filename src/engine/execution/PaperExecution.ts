import { Decimal, d } from '@/lib/decimal';
import type { Bar } from '@/types/market';
import type { Fill, Order } from '@/types/trading';
import type { ExecutionContext, ExecutionModule, TargetPosition } from '../interfaces';

/**
 * Exécution simulée en argent fictif.
 *
 * ═══ Barrière anti-look-ahead ═══
 *
 * Un ordre décidé sur la clôture de la bougie N ne peut se remplir qu'à
 * l'OUVERTURE de la bougie N+1. C'est vérifié ici, à l'unique endroit où un
 * remplissage peut naître, et c'est la règle qui sépare un backtest d'une
 * illusion : se remplir à la clôture qui a produit la décision revient à
 * acheter à un prix qu'on n'a connu qu'après avoir décidé d'acheter.
 *
 * `decidedAt` porte l'heure de CLÔTURE de la bougie de décision. Comme une
 * bougie ouvre exactement là où la précédente ferme, un ordre est remplissable
 * dès que `bar.time >= decidedAt` — ce qui ne peut être vrai que pour une
 * bougie d'index strictement supérieur.
 *
 * Frais et slippage ne sont jamais nuls. Les mettre à zéro « pour voir »
 * transforme chaque backtest en promesse que la réalité ne tiendra pas.
 */
export class PaperExecution implements ExecutionModule {
  readonly id = 'paper';

  private readonly attente: Order[] = [];
  private compteur = 0;

  submit(target: TargetPosition, ctx: ExecutionContext): Order {
    this.compteur += 1;
    const ordre: Order = {
      id: `ord-${this.compteur}`,
      symbol: target.symbol,
      side: target.side,
      type: 'market',
      quantity: target.quantity,
      // L'heure de la décision est celle de l'horloge simulée, donc la clôture
      // de la bougie qui vient d'être révélée.
      decidedAt: ctx.now,
      status: 'pending',
      reason: target.reason,
    };
    this.attente.push(ordre);
    return ordre;
  }

  onBar(bar: Bar, ctx: ExecutionContext): readonly Fill[] {
    const fills: Fill[] = [];
    const restants: Order[] = [];

    for (const ordre of this.attente) {
      if (bar.time < ordre.decidedAt) {
        // La bougie qui a produit la décision. On ne s'y remplit pas.
        restants.push(ordre);
        continue;
      }
      fills.push(remplir(ordre, bar, ctx));
    }

    this.attente.length = 0;
    this.attente.push(...restants);
    return fills;
  }

  pending(): readonly Order[] {
    return [...this.attente];
  }

  cancelAll(_reason: string): void {
    this.attente.length = 0;
  }

  reset(): void {
    this.attente.length = 0;
    this.compteur = 0;
  }
}

/**
 * Remplissage au marché : ouverture de la bougie, dégradée du slippage.
 *
 * Le slippage joue toujours CONTRE nous — plus cher à l'achat, moins cher à la
 * vente. Un modèle qui le tirerait au hasard autour de zéro s'annulerait sur un
 * grand nombre de trades et reviendrait à ne pas en avoir.
 */
function remplir(ordre: Order, bar: Bar, ctx: ExecutionContext): Fill {
  const reference = d(bar.open);
  const glissement = reference.pointsDeBase(ctx.config.slippageBps);
  const prix =
    ordre.side === 'buy' ? reference.plus(glissement) : Decimal.max(reference.moins(glissement), d(0.00000001));

  const notionnel = prix.fois(ordre.quantity);
  const frais = notionnel.pointsDeBase(ctx.config.feeBps);

  return {
    orderId: ordre.id,
    symbol: ordre.symbol,
    side: ordre.side,
    quantity: ordre.quantity,
    price: prix,
    fee: frais,
    // Coût du glissement en devise, pas le taux : c'est ce qui se compare aux
    // frais dans un journal de performance.
    slippage: glissement.fois(ordre.quantity),
    filledAt: bar.time,
  };
}
