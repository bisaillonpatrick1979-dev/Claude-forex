import { Decimal, d } from '@/lib/decimal';
import { deriveLimits } from '@/lib/portfolioMath';
import type { Bar, Timeframe } from '@/types/market';
import type { PortfolioConfig } from '@/types/portfolio';
import type { Trade } from '@/types/trading';

import { BarWindow } from './BarWindow';
import { Clock } from './Clock';
import { EventBus } from './EventBus';
import { Ledger } from './Ledger';
import { PaperExecution } from './execution/PaperExecution';
import type {
  AlphaModule,
  EngineEvents,
  ExecutionModule,
  PortfolioModule,
  RiskModule,
  TargetPosition,
  UniverseModule,
} from './interfaces';
import { EmaCrossAlpha } from './modules/EmaCrossAlpha';
import { FixedFractionPortfolio } from './modules/FixedFractionPortfolio';
import { StandardRisk } from './modules/StandardRisk';
import { StaticUniverse } from './modules/StaticUniverse';

export interface EngineOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly bars: readonly Bar[];
  readonly config: PortfolioConfig;
  readonly universe?: UniverseModule;
  readonly alpha?: AlphaModule;
  readonly portfolio?: PortfolioModule;
  readonly risk?: RiskModule;
  readonly execution?: ExecutionModule;
}

export interface EngineResult {
  readonly trades: readonly Trade[];
  readonly finalEquity: Decimal;
  readonly peakEquity: Decimal;
  readonly barsProcessed: number;
  readonly signals: number;
  readonly rejections: number;
}

/**
 * Le moteur : Univers → Alpha → Portefeuille → Risque → Exécution.
 *
 * L'ordre des opérations dans `step()` est le cœur de la garantie
 * anti-look-ahead, et il ne se réarrange pas :
 *
 *   1. Les ordres en attente rencontrent la nouvelle bougie — décidés AVANT
 *      elle, ils se remplissent à son ouverture.
 *   2. La bougie est révélée aux modules, et l'horloge passe à sa clôture.
 *   3. Les barrières des positions sont testées sur son range.
 *   4. L'alpha parle, le portefeuille dimensionne, le risque tranche.
 *   5. L'ordre part en attente — pour la bougie SUIVANTE.
 *
 * Faire (5) avant (1) remplirait un ordre sur la bougie qui l'a fait naître.
 * C'est l'erreur classique, elle transforme n'importe quelle stratégie en
 * machine à profits, et elle est invisible dans les chiffres de sortie.
 */
export class Engine {
  readonly bus = new EventBus<EngineEvents>();
  readonly clock = new Clock();

  private readonly fenetre: BarWindow;
  private readonly ledger: Ledger;
  private readonly univers: UniverseModule;
  private readonly alpha: AlphaModule;
  private readonly portefeuille: PortfolioModule;
  private readonly risque: RiskModule;
  private readonly execution: ExecutionModule;

  private readonly config: PortfolioConfig;
  /** Barrières en attente d'être attachées au remplissage qui les portera. */
  private readonly barrieresEnAttente = new Map<string, TargetPosition>();
  private readonly ordresRecents: number[] = [];
  private readonly dernierPrix = new Map<string, Decimal>();

  private signaux = 0;
  private refus = 0;
  private traitees = 0;
  private actif = true;
  private readonly departHorloge: number;

  constructor(options: EngineOptions) {
    this.config = options.config;
    this.fenetre = new BarWindow(options.symbol, options.timeframe, options.bars);
    this.ledger = new Ledger(deriveLimits(options.config).aiCapital);
    this.univers = options.universe ?? new StaticUniverse([options.symbol]);
    this.alpha = options.alpha ?? new EmaCrossAlpha();
    this.portefeuille = options.portfolio ?? new FixedFractionPortfolio();
    this.risque = options.risk ?? new StandardRisk();
    this.execution = options.execution ?? new PaperExecution();

    // Première bougie de la série : point de départ de l'horloge. Partir de
    // zéro ferait croire au contrôle de cadence que tous les ordres du premier
    // jour tiennent dans la même heure.
    this.departHorloge = options.bars[0]?.time ?? 0;
    this.clock.reset(this.departHorloge);
  }

  /** Déroule la série entière. */
  run(): EngineResult {
    while (this.step()) {
      /* rien : tout se passe dans step() */
    }
    return this.result();
  }

  /**
   * Avance d'une bougie. Rend `false` quand la série est épuisée.
   *
   * Séparé de `run()` pour le rejeu pas à pas : l'interface pilote la même
   * fonction que le backtest, donc ce qu'on voit dérouler est exactement ce qui
   * a été calculé.
   */
  step(): boolean {
    const bougie = this.fenetre.advance();
    if (!bougie) return false;
    this.traitees += 1;

    // ── 1. Les ordres décidés avant cette bougie se remplissent à son ouverture.
    //      L'horloge n'a pas encore avancé : au moment du remplissage, le
    //      présent est toujours la clôture de la bougie précédente.
    const contexteRemplissage = {
      now: this.clock.now(),
      config: this.config,
      timeframe: this.fenetre.timeframe,
    };
    for (const fill of this.execution.onBar(bougie, contexteRemplissage)) {
      const cible = this.barrieresEnAttente.get(fill.orderId);
      this.barrieresEnAttente.delete(fill.orderId);
      const trade = this.ledger.applyFill(fill, {
        ...(cible?.stopLoss ? { stopLoss: cible.stopLoss } : {}),
        ...(cible?.takeProfit ? { takeProfit: cible.takeProfit } : {}),
      });
      this.bus.emit('fill', fill);
      if (trade) this.bus.emit('trade', trade);
    }

    // ── 2. La bougie devient visible ; le présent est sa clôture.
    this.clock.advanceToClose(bougie.time, this.fenetre.timeframe);
    const maintenant = this.clock.now();
    const cloture = d(bougie.close);
    this.dernierPrix.set(this.fenetre.symbol, cloture);
    this.bus.emit('bar', { symbol: this.fenetre.symbol, bar: bougie });

    // ── 3. Barrières. Placées avant la bougie, elles ont le droit de se
    //      déclencher dedans : c'est ce que fait un stop chez un vrai broker.
    for (const touche of this.ledger.checkBarriers(this.fenetre.symbol, bougie)) {
      const trade = this.ledger.closeAt(
        touche.position,
        touche.price,
        maintenant,
        touche.reason,
        this.config.feeBps,
      );
      this.bus.emit('trade', trade);
    }

    const equite = this.ledger.equity(this.dernierPrix);
    this.ledger.markPeak(equite);

    if (!this.actif) return true;

    // ── 4. Univers, puis alpha — seulement une fois l'échauffement fait.
    const retenus = this.univers.select({ now: maintenant, candidates: [this.fenetre.symbol] });
    if (!retenus.includes(this.fenetre.symbol)) return true;

    const contexte = this.fenetre.context(maintenant);
    const signal = this.alpha.onBar(contexte);
    if (!signal || this.fenetre.revealed < this.alpha.warmup()) return true;
    this.signaux += 1;
    this.bus.emit('signal', signal);

    const contextePortefeuille = {
      now: maintenant,
      config: this.config,
      aiCapital: deriveLimits(this.config).aiCapital,
      cash: this.ledger.cash,
      equity: equite,
      price: cloture,
      positions: this.ledger.positions(),
    };

    const cible = this.portefeuille.target(signal, contextePortefeuille);
    if (!cible) return true;

    // ── 5. Risque, puis mise en attente pour la bougie suivante.
    const verdict = this.risque.vet(cible, {
      ...contextePortefeuille,
      peakEquity: this.ledger.peakEquity,
      dailyLoss: this.ledger.dailyLoss(maintenant),
      recentOrderTimes: this.ordresRecents,
    });

    if (verdict.kind === 'reject') {
      this.refus += 1;
      this.bus.emit('rejected', { reason: verdict.reason, at: maintenant });
      return true;
    }

    const retenue = verdict.target;
    // Contexte reconstruit sur l'horloge AVANCÉE. Réutiliser celui du
    // remplissage estamperait l'ordre de la clôture précédente : `decidedAt`
    // désignerait une bougie plus tôt que la décision réelle, et la barrière
    // anti-look-ahead ne tiendrait plus que par l'ordre des lignes de cette
    // fonction — exactement ce qu'elle existe pour ne pas dépendre.
    const ordre = this.execution.submit(retenue, {
      now: maintenant,
      config: this.config,
      timeframe: this.fenetre.timeframe,
    });
    this.barrieresEnAttente.set(ordre.id, retenue);
    this.ordresRecents.push(maintenant);
    // La fenêtre de cadence ne regarde qu'une heure : garder tout l'historique
    // ferait grossir ce tableau à chaque bougie sur quinze ans de données.
    while (this.ordresRecents.length > 0 && (this.ordresRecents[0] ?? 0) <= maintenant - 3_600) {
      this.ordresRecents.shift();
    }
    this.bus.emit('order', ordre);
    return true;
  }

  /** Arrêt immédiat : ordres annulés, positions laissées telles quelles. */
  halt(reason: string): void {
    this.actif = false;
    this.execution.cancelAll(reason);
    this.barrieresEnAttente.clear();
    this.bus.emit('halt', { reason, at: this.clock.now() });
  }

  result(): EngineResult {
    return {
      trades: this.ledger.trades(),
      finalEquity: this.ledger.equity(this.dernierPrix),
      peakEquity: this.ledger.peakEquity,
      barsProcessed: this.traitees,
      signals: this.signaux,
      rejections: this.refus,
    };
  }

  positions() {
    return this.ledger.positions();
  }

  reset(): void {
    // L'horloge aussi : sans elle, rejouer la même série la ferait reculer et
    // le moteur refuserait de repartir. Comparer deux réglages sur les mêmes
    // données serait alors impossible.
    this.clock.reset(this.departHorloge);
    this.fenetre.reset();
    this.ledger.reset();
    this.alpha.reset();
    this.execution.reset();
    this.barrieresEnAttente.clear();
    this.ordresRecents.length = 0;
    this.dernierPrix.clear();
    this.signaux = 0;
    this.refus = 0;
    this.traitees = 0;
    this.actif = true;
  }
}
