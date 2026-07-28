import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_CONFIG, sanitizeConfig } from '@/lib/portfolioMath';
import type { PortfolioConfig } from '@/types/portfolio';

/**
 * État du portefeuille virtuel.
 *
 * Persisté dans `localStorage`. Les montants y sont stockés en **texte**, pas
 * en nombre : sérialiser un flottant puis le relire réintroduirait exactement
 * la dérive que `lib/decimal.ts` existe pour éviter.
 *
 * Ce module ne calcule rien. Les limites dérivées vivent dans
 * `lib/portfolioMath.ts`, en fonctions pures — un store qui calcule ne se teste
 * qu'en montant une application autour.
 */

export interface EquityPoint {
  /** Secondes UNIX. */
  readonly time: number;
  readonly equity: string;
  readonly cash: string;
}

export interface PortfolioSnapshot {
  readonly cash: string;
  readonly equity: string;
  readonly peakEquity: string;
  readonly openPositions: number;
}

interface PortfolioStore {
  readonly config: PortfolioConfig;
  readonly snapshot: PortfolioSnapshot;
  readonly equityCurve: readonly EquityPoint[];
  /** L'IA a-t-elle le droit d'agir ? Faux par défaut : défaut fermé. */
  readonly aiArmed: boolean;
  readonly killSwitchArmed: boolean;
  readonly haltReason: string | null;

  setConfig: (patch: Partial<PortfolioConfig>) => void;
  armAi: (armed: boolean) => void;
  triggerKillSwitch: (reason: string) => void;
  clearKillSwitch: () => void;
  recordEquity: (point: EquityPoint) => void;
  reset: () => void;
}

/** Une remise à zéro repart du capital configuré, pas d'une constante. */
function snapshotInitial(config: PortfolioConfig): PortfolioSnapshot {
  return {
    cash: config.totalCapital,
    equity: config.totalCapital,
    // Le sommet repart du capital : le conserver ferait croire à un repli dès
    // la première seconde et mettrait la firme en pause sur un compte neuf.
    peakEquity: config.totalCapital,
    openPositions: 0,
  };
}

/** Bornée pour ne pas laisser `localStorage` grossir indéfiniment. */
const POINTS_MAX = 2_000;

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      config: DEFAULT_CONFIG,
      snapshot: snapshotInitial(DEFAULT_CONFIG),
      equityCurve: [],
      aiArmed: false,
      killSwitchArmed: false,
      haltReason: null,

      setConfig: (patch) =>
        set((etat) => {
          const config = sanitizeConfig({ ...etat.config, ...patch });

          // Changer le capital total décale le solde et l'équité du même
          // montant, au lieu de les remplacer : le P&L déjà réalisé se lit
          // comme « équité − capital initial », et l'écraser ferait
          // disparaître tous les gains et pertes en donnant l'illusion d'un
          // compte neuf.
          if (patch.totalCapital !== undefined && patch.totalCapital !== etat.config.totalCapital) {
            const ancien = Number(etat.config.totalCapital);
            const nouveau = Number(config.totalCapital);
            const ecart = Number.isFinite(ancien) && Number.isFinite(nouveau) ? nouveau - ancien : 0;

            return {
              config,
              snapshot: {
                ...etat.snapshot,
                cash: (Number(etat.snapshot.cash) + ecart).toFixed(2),
                equity: (Number(etat.snapshot.equity) + ecart).toFixed(2),
                peakEquity: Math.max(
                  Number(etat.snapshot.peakEquity) + ecart,
                  nouveau,
                ).toFixed(2),
              },
            };
          }

          return { config };
        }),

      armAi: (armed) =>
        set((etat) =>
          // Le coupe-circuit prime : tant qu'il est armé, rien ne réarme l'IA.
          etat.killSwitchArmed ? etat : { aiArmed: armed },
        ),

      triggerKillSwitch: (reason) =>
        set({ killSwitchArmed: true, aiArmed: false, haltReason: reason }),

      /**
       * Lever le coupe-circuit ne réarme pas l'IA.
       *
       * Deux gestes séparés, volontairement : reprendre la main après un arrêt
       * ne veut pas dire vouloir immédiatement relancer les agents. L'inverse
       * — un réarmement automatique — est exactement la surprise qu'on ne veut
       * pas après avoir tout coupé.
       */
      clearKillSwitch: () => set({ killSwitchArmed: false, haltReason: null }),

      recordEquity: (point) =>
        set((etat) => {
          const courbe = [...etat.equityCurve, point].slice(-POINTS_MAX);
          const equite = Number(point.equity);
          const sommet = Math.max(Number(etat.snapshot.peakEquity), equite);

          return {
            equityCurve: courbe,
            snapshot: {
              ...etat.snapshot,
              cash: point.cash,
              equity: point.equity,
              peakEquity: Number.isFinite(sommet) ? sommet.toFixed(2) : etat.snapshot.peakEquity,
            },
          };
        }),

      reset: () =>
        set({
          snapshot: snapshotInitial(get().config),
          equityCurve: [],
          aiArmed: false,
          killSwitchArmed: false,
          haltReason: null,
        }),
    }),
    {
      name: 'hailquant:portfolio',
      version: 1,
      // La configuration et l'état sont persistés ; rien d'autre. Un jour où
      // le store portera des données volumineuses, elles n'iront pas ici.
      partialize: (etat) => ({
        config: etat.config,
        snapshot: etat.snapshot,
        equityCurve: etat.equityCurve,
        aiArmed: etat.aiArmed,
        killSwitchArmed: etat.killSwitchArmed,
        haltReason: etat.haltReason,
      }),
    },
  ),
);
