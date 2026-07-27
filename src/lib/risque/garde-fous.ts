import { valeurNotionnelle } from '@/lib/execution/marge';
import type {
  EtatPortefeuille,
  Instrument,
  PositionOuverte,
  Sens,
} from '@/lib/execution/types';

import {
  evaluerConcentration,
  sourceFacteurs,
  type LimitesConcentration,
  type SourceFacteurs,
} from './concentration';
import { correlationInstruments } from './correlation';
import {
  evaluerBudgetRisque,
  risqueAgrege,
  type PositionRisquee,
  type SourceCorrelation,
} from './portefeuille';

/**
 * Garde-fous de risque — fonction pure, testée, appelée avant toute création
 * d'ordre.
 *
 * Ces plafonds ne sont **pas** dans les prompts. Un agent LLM ne doit jamais
 * être la dernière barrière avant une perte : ce sont des `if` en TypeScript
 * côté serveur, et ils rejettent ou réduisent sans possibilité d'être
 * persuadés.
 *
 * La fonction ne lit ni la base ni l'heure système : tout entre par
 * paramètre, tout est reproductible.
 */

export interface ParametresRisque {
  readonly risqueMaxParTradePct: number;
  readonly risqueTotalMaxPct: number;
  readonly positionsMax: number;
  /** Part maximale du risque agrégé qu'une seule position peut porter, en %. */
  readonly partPositionMaxPct: number;
  /** Exposition nette maximale d'un facteur, en % du budget de risque total. */
  readonly partFacteurMaxPct: number;
  readonly perteJournaliereMaxPct: number;
  readonly drawdownMaxPct: number;
  readonly levierMax: number;
  readonly fenetreEvenementMacroMinutes: number;
  readonly stopLossObligatoire: boolean;
}

export interface EvenementMacro {
  readonly horodatage: number;
  readonly impact: 'FAIBLE' | 'MOYEN' | 'FORT';
  readonly libelle: string;
}

export interface DemandeOrdre {
  readonly instrument: Instrument;
  readonly sens: Sens;
  readonly quantite: number;
  readonly prixEntree: number;
  readonly stopLoss: number | null;
  readonly tauxCotationVersCompte: number | null;
}

export interface PositionAvecInstrument {
  readonly position: PositionOuverte;
  readonly instrument: Instrument;
  readonly tauxCotationVersCompte: number;
  readonly prixCourant: number;
}

export interface EtatRisque {
  readonly portefeuille: EtatPortefeuille;
  readonly positions: readonly PositionAvecInstrument[];
  /** Équité à l'ouverture de la journée, pour la perte journalière. */
  readonly equiteDebutJournee: number;
  readonly evenementsMacro: readonly EvenementMacro[];
  readonly maintenant: number;
}

export type StatutControle = 'OK' | 'REDUIT' | 'REFUSE';

export interface Controle {
  readonly code: string;
  readonly libelle: string;
  readonly statut: StatutControle;
  readonly detail: string;
}

export interface DecisionGardeFous {
  readonly decision: 'APPROUVE' | 'REDUIT' | 'REFUSE';
  readonly quantiteAutorisee: number;
  readonly raison: string;
  readonly risqueEstimePct: number | null;
  readonly controles: readonly Controle[];
}

/** Sous ce seuil, une position n'a plus de sens : on refuse au lieu de
 *  laisser passer un ordre symbolique. */
const QUANTITE_MINIMALE_LOTS = 0.01;

/** Risque encouru par lot, dans la devise du portefeuille. */
export function risqueParLot(
  instrument: Instrument,
  prixEntree: number,
  stopLoss: number,
  taux: number,
): number {
  return Math.abs(prixEntree - stopLoss) * instrument.tailleContrat * taux;
}

/**
 * Corrélation entre deux instruments, par leur code.
 *
 * L'heuristique par vecteurs de devises est la seule source disponible ici :
 * le garde-fou reçoit un état de portefeuille, pas des séries de prix. Quand
 * l'appelant dispose d'un historique, il peut fournir une matrice mesurée —
 * c'est le rôle de `SourceCorrelation`.
 */
function correlationEntreInstruments(
  positions: readonly PositionAvecInstrument[],
  propose: Instrument,
): SourceCorrelation {
  const connus = new Map<string, Instrument>([[propose.code, propose]]);
  for (const entree of positions) connus.set(entree.instrument.code, entree.instrument);

  return (a, b) => {
    const instrumentA = connus.get(a);
    const instrumentB = connus.get(b);
    if (!instrumentA || !instrumentB) return 0;
    return correlationInstruments(
      {
        instrument: instrumentA.code,
        classeActif: instrumentA.classeActif,
        deviseBase: instrumentA.deviseBase,
        deviseCotation: instrumentA.deviseCotation,
      },
      {
        instrument: instrumentB.code,
        classeActif: instrumentB.classeActif,
        deviseBase: instrumentB.deviseBase,
        deviseCotation: instrumentB.deviseCotation,
      },
    );
  };
}

/** Décomposition en facteurs des instruments présents dans la décision. */
function facteursEntreInstruments(
  positions: readonly PositionAvecInstrument[],
  propose: Instrument,
): SourceFacteurs {
  const connus = new Map<string, Instrument>([[propose.code, propose]]);
  for (const entree of positions) connus.set(entree.instrument.code, entree.instrument);

  return sourceFacteurs(
    [...connus.values()].map((instrument) => ({
      code: instrument.code,
      classeActif: instrument.classeActif,
      deviseBase: instrument.deviseBase,
      deviseCotation: instrument.deviseCotation,
    })),
  );
}

/**
 * Détail affiché du contrôle de concentration.
 *
 * On publie le facteur le plus chargé plutôt qu'un simple « conforme » : la
 * question utile n'est pas de savoir si la limite est respectée, mais de quel
 * côté penche le portefeuille — c'est précisément ce que l'ancien compteur ne
 * pouvait pas dire.
 */
function detailConcentration(
  decision: ReturnType<typeof evaluerConcentration>,
  parametres: ParametresRisque,
  budgetTotal: number,
): string {
  const { analyse } = decision;
  if (analyse.facteurs.length === 0) {
    return `Aucune position ouverte : rien à concentrer.`;
  }

  const dominant = analyse.facteurs[0]!;
  const plafondFacteur = (parametres.partFacteurMaxPct / 100) * budgetTotal;

  return (
    `${analyse.parisEffectifs.toFixed(1)} pari(s) effectif(s) ; ` +
    `${dominant.facteur} ${Math.abs(dominant.expositionNette).toFixed(2)} net ` +
    `/ ${plafondFacteur.toFixed(2)} ; ` +
    `position la plus lourde ${analyse.partPositionMaxPct.toFixed(0)} % / ${parametres.partPositionMaxPct} %`
  );
}

export function evaluerGardeFous(
  demande: DemandeOrdre,
  etat: EtatRisque,
  parametres: ParametresRisque,
): DecisionGardeFous {
  const controles: Controle[] = [];
  const refuser = (code: string, libelle: string, detail: string): DecisionGardeFous => {
    controles.push({ code, libelle, statut: 'REFUSE', detail });
    return {
      decision: 'REFUSE',
      quantiteAutorisee: 0,
      raison: detail,
      risqueEstimePct: null,
      controles,
    };
  };

  const { portefeuille } = etat;
  const equite = portefeuille.equite;

  // --- Refus francs, sans négociation possible ----------------------------

  if (portefeuille.gele) {
    return refuser('GEL', 'Portefeuille gelé', 'Le portefeuille est gelé (kill switch).');
  }

  if (demande.tauxCotationVersCompte === null) {
    return refuser(
      'CONVERSION',
      'Taux de conversion inconnu',
      `Aucun taux connu de ${demande.instrument.deviseCotation} vers ${portefeuille.devise} : le risque ne peut pas être chiffré.`,
    );
  }
  const taux = demande.tauxCotationVersCompte;

  if (parametres.stopLossObligatoire && demande.stopLoss === null) {
    return refuser('STOP_ABSENT', 'Stop-loss obligatoire', 'Ordre sans stop-loss : rejeté.');
  }

  if (demande.stopLoss !== null) {
    const stopValide =
      demande.sens === 'ACHAT'
        ? demande.stopLoss < demande.prixEntree
        : demande.stopLoss > demande.prixEntree;
    if (!stopValide) {
      return refuser(
        'STOP_INCOHERENT',
        'Stop du mauvais côté',
        `Stop à ${demande.stopLoss} incohérent avec une entrée ${demande.sens} à ${demande.prixEntree}.`,
      );
    }
  }

  const drawdownPct =
    portefeuille.sommetEquite > 0
      ? ((portefeuille.sommetEquite - equite) / portefeuille.sommetEquite) * 100
      : 0;
  if (drawdownPct >= parametres.drawdownMaxPct) {
    return refuser(
      'DRAWDOWN',
      'Drawdown maximal atteint',
      `Drawdown de ${drawdownPct.toFixed(2)} % depuis le sommet (limite ${parametres.drawdownMaxPct} %) : arrêt complet, intervention manuelle requise.`,
    );
  }
  controles.push({
    code: 'DRAWDOWN',
    libelle: 'Drawdown depuis le sommet',
    statut: 'OK',
    detail: `${drawdownPct.toFixed(2)} % / ${parametres.drawdownMaxPct} %`,
  });

  const perteJournalierePct =
    etat.equiteDebutJournee > 0
      ? ((etat.equiteDebutJournee - equite) / etat.equiteDebutJournee) * 100
      : 0;
  if (perteJournalierePct >= parametres.perteJournaliereMaxPct) {
    return refuser(
      'PERTE_JOURNALIERE',
      'Perte journalière maximale',
      `Perte de ${perteJournalierePct.toFixed(2)} % sur la journée (limite ${parametres.perteJournaliereMaxPct} %) : agents en pause jusqu'au lendemain.`,
    );
  }
  controles.push({
    code: 'PERTE_JOURNALIERE',
    libelle: 'Perte journalière',
    statut: 'OK',
    detail: `${perteJournalierePct.toFixed(2)} % / ${parametres.perteJournaliereMaxPct} %`,
  });

  const fenetreSecondes = parametres.fenetreEvenementMacroMinutes * 60;
  const evenementProche = etat.evenementsMacro.find(
    (evenement) =>
      evenement.impact === 'FORT' &&
      Math.abs(evenement.horodatage - etat.maintenant) <= fenetreSecondes,
  );
  if (evenementProche) {
    return refuser(
      'EVENEMENT_MACRO',
      'Fenêtre d’événement macro',
      `« ${evenementProche.libelle} » à moins de ${parametres.fenetreEvenementMacroMinutes} min : aucune ouverture.`,
    );
  }
  controles.push({
    code: 'EVENEMENT_MACRO',
    libelle: 'Fenêtre d’événement macro',
    statut: 'OK',
    detail: `Aucun événement à fort impact dans les ${parametres.fenetreEvenementMacroMinutes} min.`,
  });

  if (etat.positions.length >= parametres.positionsMax) {
    return refuser(
      'POSITIONS_MAX',
      'Nombre de positions',
      `${etat.positions.length} positions ouvertes (maximum ${parametres.positionsMax}).`,
    );
  }
  controles.push({
    code: 'POSITIONS_MAX',
    libelle: 'Nombre de positions',
    statut: 'OK',
    detail: `${etat.positions.length} / ${parametres.positionsMax}`,
  });

  // --- Contraintes qui réduisent la taille plutôt que de refuser -----------

  let quantite = demande.quantite;
  const reductions: string[] = [];

  const parLot =
    demande.stopLoss !== null
      ? risqueParLot(demande.instrument, demande.prixEntree, demande.stopLoss, taux)
      : 0;

  if (parLot > 0) {
    const budget = (parametres.risqueMaxParTradePct / 100) * equite;
    const maximum = budget / parLot;
    if (quantite > maximum) {
      reductions.push(
        `risque par trade plafonné à ${parametres.risqueMaxParTradePct} % (${budget.toFixed(2)} ${portefeuille.devise})`,
      );
      quantite = maximum;
    }
    controles.push({
      code: 'RISQUE_TRADE',
      libelle: 'Risque par trade',
      statut: quantite < demande.quantite ? 'REDUIT' : 'OK',
      detail: `${((quantite * parLot) / equite * 100).toFixed(2)} % / ${parametres.risqueMaxParTradePct} %`,
    });

    // Risque déjà engagé, position par position, avant agrégation.
    const ouvertes: PositionRisquee[] = [];
    for (const entree of etat.positions) {
      if (entree.position.stopLoss === null) continue;
      ouvertes.push({
        instrument: entree.instrument.code,
        sens: entree.position.sens,
        risque:
          risqueParLot(
            entree.instrument,
            entree.prixCourant,
            entree.position.stopLoss,
            entree.tauxCotationVersCompte,
          ) * entree.position.quantite,
      });
    }

    // Le budget se compare au risque **agrégé**, pas à la somme. Additionner
    // facturait le même montant à une couverture parfaite et à un pari doublé :
    // le premier cas se voyait refuser une position qui ne coûte rien.
    const correlation = correlationEntreInstruments(etat.positions, demande.instrument);
    const budgetTotal = (parametres.risqueTotalMaxPct / 100) * equite;

    const budgetDecision = evaluerBudgetRisque(
      ouvertes,
      { instrument: demande.instrument.code, sens: demande.sens },
      budgetTotal,
      correlation,
    );

    if (budgetDecision.refuse) {
      return refuser('RISQUE_TOTAL', 'Risque total simultané', budgetDecision.explication);
    }

    const maximumTotal = budgetDecision.risqueAutorise / parLot;
    if (quantite > maximumTotal) {
      const agrege = risqueAgrege(ouvertes, correlation);
      reductions.push(
        `risque agrégé plafonné à ${parametres.risqueTotalMaxPct} % ` +
          `(${agrege.risqueEffectif.toFixed(2)} engagés sur ${budgetTotal.toFixed(2)}, ` +
          `pour ${agrege.risqueSomme.toFixed(2)} en somme brute)`,
      );
      quantite = maximumTotal;
    }

    controles.push({
      code: 'RISQUE_TOTAL',
      libelle: 'Risque total simultané',
      statut: quantite < demande.quantite ? 'REDUIT' : 'OK',
      detail:
        `${((budgetDecision.risqueApres / equite) * 100).toFixed(2)} % / ${parametres.risqueTotalMaxPct} % ` +
        `(diversification : ${(risqueAgrege(ouvertes, correlation).ratioDiversification * 100).toFixed(0)} % du brut)`,
    });

    // Le budget agrégé dit combien de risque il reste ; la concentration dit
    // comment il a le droit d'être réparti. Un portefeuille peut respecter le
    // premier tout en étant trois fois le même pari — c'est exactement ce que
    // l'ancien compteur de positions corrélées laissait passer.
    const limites: LimitesConcentration = {
      partPositionMaxPct: parametres.partPositionMaxPct,
      partFacteurMaxPct: parametres.partFacteurMaxPct,
    };
    const facteurs = facteursEntreInstruments(etat.positions, demande.instrument);
    const concentration = evaluerConcentration(
      ouvertes,
      { instrument: demande.instrument.code, sens: demande.sens },
      budgetTotal,
      limites,
      correlation,
      facteurs,
    );

    if (concentration.refuse) {
      return refuser('CONCENTRATION', 'Concentration du risque', concentration.explication);
    }

    const maximumConcentration = concentration.risqueAutorise / parLot;
    if (quantite > maximumConcentration) {
      reductions.push(
        concentration.contrainte === 'FACTEUR' && concentration.facteurLimitant
          ? `concentration sur ${concentration.facteurLimitant} plafonnée à ${parametres.partFacteurMaxPct} % du budget de risque`
          : `part d’une position plafonnée à ${parametres.partPositionMaxPct} % du risque agrégé`,
      );
      quantite = maximumConcentration;
    }

    controles.push({
      code: 'CONCENTRATION',
      libelle: 'Concentration du risque',
      statut: quantite < demande.quantite ? 'REDUIT' : 'OK',
      detail: detailConcentration(concentration, parametres, budgetTotal),
    });
  }

  const notionnelOuvert = etat.positions.reduce(
    (somme, entree) =>
      somme +
      valeurNotionnelle(
        entree.instrument,
        entree.position.quantite,
        entree.prixCourant,
        entree.tauxCotationVersCompte,
      ),
    0,
  );
  const notionnelParLot = valeurNotionnelle(demande.instrument, 1, demande.prixEntree, taux);
  const notionnelMax = parametres.levierMax * equite;
  const notionnelDisponible = Math.max(0, notionnelMax - notionnelOuvert);

  if (notionnelParLot > 0 && quantite * notionnelParLot > notionnelDisponible) {
    reductions.push(`levier plafonné à ${parametres.levierMax}:1`);
    quantite = notionnelDisponible / notionnelParLot;
  }
  controles.push({
    code: 'LEVIER',
    libelle: 'Levier',
    statut: quantite < demande.quantite ? 'REDUIT' : 'OK',
    detail: `${((notionnelOuvert + quantite * notionnelParLot) / Math.max(equite, 1e-9)).toFixed(2)}:1 / ${parametres.levierMax}:1`,
  });

  // Arrondi au centième de lot, vers le bas : jamais arrondir une taille vers
  // le haut, ce serait dépasser la limite qu'on vient de calculer.
  //
  // La tolérance est indispensable : 1.08 − 1.075 vaut 0.005000000000000004 en
  // binaire, donc un plafond théorique de 2 lots ressortait à 1.9999999999999984,
  // que le plancher transformait en 1,99. Une miette de représentation coûtait
  // un demi-pour-cent de taille à chaque ordre.
  quantite = Math.floor(quantite * 100 + 1e-9) / 100;

  if (quantite < QUANTITE_MINIMALE_LOTS) {
    return refuser(
      'TAILLE_MINIMALE',
      'Taille résiduelle nulle',
      `Après application des limites, la taille autorisée tombe à ${quantite} lot : ordre refusé.`,
    );
  }

  const risquePct = parLot > 0 ? ((quantite * parLot) / equite) * 100 : null;

  if (quantite < demande.quantite) {
    return {
      decision: 'REDUIT',
      quantiteAutorisee: quantite,
      raison: `Taille réduite de ${demande.quantite} à ${quantite} lot(s) : ${reductions.join(' ; ')}.`,
      risqueEstimePct: risquePct,
      controles,
    };
  }

  return {
    decision: 'APPROUVE',
    quantiteAutorisee: quantite,
    raison: `Ordre conforme à toutes les limites (risque ${risquePct?.toFixed(2) ?? '—'} %).`,
    risqueEstimePct: risquePct,
    controles,
  };
}
