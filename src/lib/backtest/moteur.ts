import { tauxConversion } from '@/lib/execution/couts';
import { creerOrdre, fermerManuellement, traiterBougie } from '@/lib/execution/moteur';
import {
  SIMULATION_DEFAUT,
  type EtatMoteur,
  type EtatPortefeuille,
  type Evenement,
  type Instrument,
  type OrdreEnAttente,
  type ParametresSimulation,
  type PositionOuverte,
  type Sens,
  type TypeOrdre,
} from '@/lib/execution/types';
import { atr, derniereValeur } from '@/lib/marche/indicateurs';
import type { Chandelier, Intervalle } from '@/lib/marche/types';

/**
 * Moteur de backtest.
 *
 * Il n'implémente aucune règle de trading : il rejoue des bougies et confie
 * chaque décision à un décideur. Ce qu'il garantit, c'est que ce décideur ne
 * peut pas tricher — et c'est tout l'intérêt de l'exercice.
 *
 * **Deux barrières, distinctes et toutes deux nécessaires.**
 *
 * La barrière d'information : le décideur ne reçoit jamais le tableau complet
 * des bougies, seulement une tranche coupée à l'instant de la décision. Ce
 * n'est pas une consigne qu'on lui donne, c'est une donnée qu'il n'a pas. Une
 * stratégie qui voudrait lire la bougie suivante n'a rien à lire.
 *
 * La barrière d'exécution : un ordre décidé sur la bougie N ne peut se remplir
 * qu'à partir de N+1. Elle est portée par `horodatageDecision`, que le moteur
 * d'exécution fait respecter — on se contente ici de le renseigner
 * honnêtement. Sans elle, une stratégie « achète quand la bougie clôture en
 * hausse » se remplirait à l'ouverture de cette même bougie, c'est-à-dire à un
 * prix qu'on ne connaît qu'après coup. C'est le défaut qui fait qu'un backtest
 * rend 400 % par an sur le papier et perd de l'argent en réel.
 *
 * Le calcul des coûts — spread, commission, swap, slippage, marge, appel de
 * marge — n'est pas réimplémenté : c'est exactement le même moteur qui exécute
 * le portefeuille papier. Un backtest qui utiliserait sa propre arithmétique
 * plus clémente ne prédirait rien.
 */

/** Ce que le décideur voit. Rien de plus n'existe pour lui. */
export interface VueDecision {
  /** Bougies jusqu'à celle en cours **incluse**. Jamais au-delà. */
  readonly bougies: readonly Chandelier[];
  readonly bougie: Chandelier;
  readonly index: number;
  readonly instrument: Instrument;
  readonly intervalle: Intervalle;
  readonly portefeuille: EtatPortefeuille;
  readonly positions: readonly PositionOuverte[];
  readonly ordresEnAttente: readonly OrdreEnAttente[];
  readonly atr: number | null;
}

export interface IntentionOrdre {
  readonly sens: Sens;
  readonly type?: TypeOrdre;
  readonly quantite: number;
  readonly prixDemande?: number | null;
  readonly stopLoss?: number | null;
  readonly takeProfit?: number | null;
  readonly valideJusqua?: number | null;
}

/** Fermeture demandée par le décideur, honorée à la bougie suivante. */
export interface IntentionFermeture {
  readonly positionId: string;
}

export interface Decision {
  readonly ordres?: readonly IntentionOrdre[];
  readonly fermetures?: readonly IntentionFermeture[];
}

export type Decideur = (vue: VueDecision) => Decision;

export interface OptionsBacktest {
  readonly chandeliers: readonly Chandelier[];
  readonly instrument: Instrument;
  readonly intervalle: Intervalle;
  readonly capitalInitial: number;
  readonly decideur: Decideur;
  readonly devise?: string;
  readonly parametres?: ParametresSimulation;
  /** Bougies réservées au calcul des indicateurs, sans décision possible. */
  readonly echauffement?: number;
}

export interface PointEquite {
  readonly horodatage: number;
  readonly equite: number;
  readonly solde: number;
}

export interface TradeFerme {
  readonly positionId: string;
  readonly sens: Sens;
  readonly quantite: number;
  readonly ouvertLe: number;
  readonly fermeLe: number;
  readonly prixEntree: number;
  readonly prixSortie: number;
  readonly resultat: number;
  readonly motif: string;
}

export interface ResultatBacktest {
  readonly courbeEquite: readonly PointEquite[];
  readonly trades: readonly TradeFerme[];
  readonly etatFinal: EtatMoteur;
  readonly bougiesTraitees: number;
  readonly evenements: readonly Evenement[];
}

const ECHAUFFEMENT_DEFAUT = 20;
const PERIODE_ATR = 14;

export function executerBacktest(options: OptionsBacktest): ResultatBacktest {
  const parametres = options.parametres ?? SIMULATION_DEFAUT;
  const devise = options.devise ?? 'USD';
  const echauffement = Math.max(options.echauffement ?? ECHAUFFEMENT_DEFAUT, 1);

  let etat: EtatMoteur = {
    portefeuille: {
      devise,
      capitalInitial: options.capitalInitial,
      solde: options.capitalInitial,
      equite: options.capitalInitial,
      margeUtilisee: 0,
      sommetEquite: options.capitalInitial,
      gele: false,
    },
    ordres: [],
    positions: [],
  };

  const courbeEquite: PointEquite[] = [];
  const trades: TradeFerme[] = [];
  const evenements: Evenement[] = [];
  const ouvertures = new Map<string, PositionOuverte>();
  let fermeturesEnAttente: string[] = [];

  for (let index = 0; index < options.chandeliers.length; index += 1) {
    const bougie = options.chandeliers[index]!;
    const jusquIci = options.chandeliers.slice(0, index + 1);
    const valeurAtr = derniereValeur(atr(jusquIci, PERIODE_ATR));
    const taux = tauxConversion(options.instrument, bougie.cloture, devise);

    const contexte = {
      instrument: options.instrument,
      intervalle: options.intervalle,
      bougie,
      atr: valeurAtr,
      tauxCotationVersCompte: taux,
      parametres,
    };

    // 1. La bougie est traitée avec les ordres décidés **avant** elle. C'est
    //    ici que la barrière d'exécution produit son effet.
    const resultat = traiterBougie(etat, contexte);
    etat = resultat.etat;
    evenements.push(...resultat.evenements);

    for (const position of etat.positions) {
      if (!ouvertures.has(position.id)) ouvertures.set(position.id, position);
    }
    releverFermetures(resultat.evenements, ouvertures, trades);

    // 2. Les fermetures demandées à la bougie précédente sont honorées ici,
    //    sur celle-ci. Le moteur d'exécution ne compense pas les positions :
    //    un ordre de sens inverse en ouvrirait une seconde au lieu de solder
    //    la première. La fermeture passe donc par fermerManuellement, mais
    //    jamais sur la bougie où elle a été décidée — sortir au cours de la
    //    bougie qui a déclenché la décision serait exactement le look-ahead
    //    qu'on interdit à l'entrée.
    for (const positionId of fermeturesEnAttente) {
      const fermeture = fermerManuellement(etat, positionId, contexte, 'FERMETURE_AGENT');
      etat = fermeture.etat;
      evenements.push(...fermeture.evenements);
      releverFermetures(fermeture.evenements, ouvertures, trades);
    }
    fermeturesEnAttente = [];

    courbeEquite.push({
      horodatage: bougie.horodatage,
      equite: etat.portefeuille.equite,
      solde: etat.portefeuille.solde,
    });

    // 3. Puis seulement, le décideur regarde ce qui vient de se passer. Sa
    //    vue s'arrête à cette bougie ; ses ordres porteront son horodatage et
    //    ne pourront donc pas s'y remplir.
    if (index < echauffement || index === options.chandeliers.length - 1) continue;
    if (etat.portefeuille.gele) continue;

    const decision = options.decideur({
      bougies: jusquIci,
      bougie,
      index,
      instrument: options.instrument,
      intervalle: options.intervalle,
      portefeuille: etat.portefeuille,
      positions: etat.positions,
      ordresEnAttente: etat.ordres,
      atr: valeurAtr,
    });

    etat = appliquerDecision(etat, decision, bougie.horodatage, options.instrument.code);
    fermeturesEnAttente = (decision.fermetures ?? [])
      .map((fermeture) => fermeture.positionId)
      .filter((positionId) => etat.positions.some((position) => position.id === positionId));
  }

  return {
    courbeEquite,
    trades,
    etatFinal: etat,
    bougiesTraitees: options.chandeliers.length,
    evenements,
  };
}

/** Les ouvertures deviennent des ordres en attente datés de la décision. Les
 *  fermetures sont mises en file à part : le moteur ne compense pas, elles
 *  passent par fermerManuellement à la bougie suivante. */
function appliquerDecision(
  etat: EtatMoteur,
  decision: Decision,
  horodatageDecision: number,
  instrument: string,
): EtatMoteur {
  const nouveaux: OrdreEnAttente[] = [];

  for (const intention of decision.ordres ?? []) {
    if (!(intention.quantite > 0)) continue;
    nouveaux.push(
      creerOrdre({
        instrument,
        sens: intention.sens,
        type: intention.type ?? 'MARCHE',
        quantite: intention.quantite,
        prixDemande: intention.prixDemande ?? null,
        stopLoss: intention.stopLoss ?? null,
        takeProfit: intention.takeProfit ?? null,
        horodatageDecision,
        valideJusqua: intention.valideJusqua ?? null,
      }),
    );
  }

  if (nouveaux.length === 0) return etat;
  return { ...etat, ordres: [...etat.ordres, ...nouveaux] };
}

function releverFermetures(
  evenements: readonly Evenement[],
  ouvertures: Map<string, PositionOuverte>,
  trades: TradeFerme[],
): void {
  for (const evenement of evenements) {
    if (evenement.type !== 'POSITION_FERMEE' || !evenement.positionId) continue;
    const position = ouvertures.get(evenement.positionId);
    if (!position) continue;

    trades.push({
      positionId: position.id,
      sens: position.sens,
      quantite: position.quantite,
      ouvertLe: position.ouvertLe,
      fermeLe: evenement.horodatage,
      prixEntree: position.prixEntree,
      prixSortie: evenement.prix ?? position.prixEntree,
      resultat: evenement.montant ?? 0,
      motif: String(evenement.motif ?? 'INCONNU'),
    });
    ouvertures.delete(evenement.positionId);
  }
}
