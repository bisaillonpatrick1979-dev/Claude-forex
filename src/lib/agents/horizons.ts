import { commission, valeurPoint } from '@/lib/execution/couts';
import type { Instrument } from '@/lib/execution/types';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Horizons de trading.
 *
 * Scalping, intraday, swing, position : ce ne sont pas quatre styles au choix
 * du goût, ce sont quatre régimes de contraintes différents. Ce qui les sépare
 * n'est pas la durée mais **le rapport entre le mouvement visé et le coût de
 * l'aller-retour**.
 *
 * Un scalpeur vise quelques dixièmes de pour cent et paie le spread, la
 * commission et le slippage à chaque passage : les frais peuvent absorber la
 * moitié du gain espéré. Un trader de position vise plusieurs pour cent et paie
 * les mêmes frais une seule fois, mais porte des nuits de swap. Appliquer les
 * mêmes règles aux deux produit soit un scalpeur ruiné par les frais, soit un
 * trader de position qui sort trop tôt.
 *
 * D'où le choix central de ce module : **la firme choisit un horizon, et le
 * système refuse de le pratiquer sur un instrument où il ne peut pas payer ses
 * frais.** C'est un calcul, pas une opinion — et c'est le contrôle que la
 * plupart des systèmes grand public ne font pas, ce qui explique une bonne
 * partie des stratégies de scalping qui « marchent en backtest ».
 *
 * Les agents connaissent les quatre horizons ; c'est l'horizon actif de la
 * firme qui décide lequel ils appliquent.
 */

export const HORIZONS = ['SCALPING', 'INTRADAY', 'SWING', 'POSITION'] as const;
export type Horizon = (typeof HORIZONS)[number];

export function estHorizon(valeur: string): valeur is Horizon {
  return (HORIZONS as readonly string[]).includes(valeur);
}

export interface ProfilHorizon {
  readonly code: Horizon;
  readonly nom: string;
  readonly resume: string;
  /** Intervalle sur lequel la décision se prend. */
  readonly intervalleDecision: Intervalle;
  /** Intervalle supérieur, consulté pour le biais de fond. */
  readonly intervalleContexte: Intervalle;
  readonly detentionTypiqueMinutes: number;
  readonly detentionMaxMinutes: number;
  readonly multipleStopAtr: number;
  readonly multipleCibleAtr: number;
  readonly tradesMaxParJour: number;
  /** Nuits portées en moyenne : ce qui déclenche les frais de swap. */
  readonly nuitsPortees: number;
  /**
   * Part du gain brut visé que les frais peuvent absorber sans que l'horizon
   * devienne intenable. Plus l'horizon est court, plus la tolérance doit être
   * large — mais au-delà, aucune finesse d'analyse ne compense.
   */
  readonly partCoutsToleree: number;
  /** Consigne injectée dans le prompt des agents. */
  readonly consigne: string;
}

const MINUTE = 1;
const HEURE = 60;
const JOUR = 24 * HEURE;

export const PROFILS_HORIZON: Readonly<Record<Horizon, ProfilHorizon>> = {
  SCALPING: {
    code: 'SCALPING',
    nom: 'Scalping',
    resume:
      'Quelques minutes par position, sur les séances les plus liquides. Beaucoup de trades, gains minuscules, frais déterminants.',
    intervalleDecision: 'M1',
    intervalleContexte: 'M15',
    detentionTypiqueMinutes: 5 * MINUTE,
    detentionMaxMinutes: 30 * MINUTE,
    multipleStopAtr: 1,
    multipleCibleAtr: 1.5,
    tradesMaxParJour: 20,
    nuitsPortees: 0,
    partCoutsToleree: 0.25,
    consigne:
      "Horizon : SCALPING. Tu vises quelques minutes de détention, jamais plus de trente. Tu ne portes aucune position d'une séance à l'autre. Le spread et la commission sont ton adversaire principal : n'entre que sur un déséquilibre net et immédiat, et refuse tout instrument dont l'écart de cotation mange le mouvement visé. Une hésitation vaut une abstention — attendre le prochain signal ne coûte rien, un aller-retour raté coûte deux fois les frais.",
  },
  INTRADAY: {
    code: 'INTRADAY',
    nom: 'Intraday',
    resume:
      'Une à quelques heures, tout se solde avant la clôture. Le rythme des séances gouverne les entrées.',
    intervalleDecision: 'M15',
    intervalleContexte: 'H1',
    detentionTypiqueMinutes: 3 * HEURE,
    detentionMaxMinutes: 12 * HEURE,
    multipleStopAtr: 1.5,
    multipleCibleAtr: 2.5,
    tradesMaxParJour: 6,
    nuitsPortees: 0,
    partCoutsToleree: 0.2,
    consigne:
      "Horizon : INTRADAY. Tu ouvres et tu soldes dans la même journée, sans jamais porter de nuit — donc sans frais de portage, mais sans droit à l'attente non plus. Les ouvertures de Londres et de New York sont tes fenêtres ; hors séance active, l'abstention est la règle. Le biais de fond se lit sur l'unité supérieure, l'entrée se déclenche sur l'unité de décision : ne prends pas un signal court à contresens du biais de fond.",
  },
  SWING: {
    code: 'SWING',
    nom: 'Swing',
    resume:
      'Quelques jours à quelques semaines. On porte des nuits, donc du swap et du risque de gap.',
    intervalleDecision: 'H4',
    intervalleContexte: 'D1',
    detentionTypiqueMinutes: 3 * JOUR,
    detentionMaxMinutes: 21 * JOUR,
    multipleStopAtr: 2,
    multipleCibleAtr: 4,
    tradesMaxParJour: 2,
    nuitsPortees: 3,
    partCoutsToleree: 0.12,
    consigne:
      "Horizon : SWING. Tu portes des positions plusieurs jours, donc tu paies des frais de portage et tu t'exposes aux ouvertures en écart — un stop ne protège pas d'un gap de week-end. Dimensionne en conséquence et évite d'ouvrir juste avant une publication majeure ou une fin de semaine. Le bruit intrajournalier ne te concerne pas : ne resserre pas un stop parce que le prix a bougé pendant une heure.",
  },
  POSITION: {
    code: 'POSITION',
    nom: 'Position',
    resume:
      'Plusieurs semaines à plusieurs mois. Le fond macro décide, la technique ne fait que dater l’entrée.',
    intervalleDecision: 'D1',
    intervalleContexte: 'W1',
    detentionTypiqueMinutes: 45 * JOUR,
    detentionMaxMinutes: 180 * JOUR,
    multipleStopAtr: 3,
    multipleCibleAtr: 8,
    tradesMaxParJour: 1,
    nuitsPortees: 45,
    partCoutsToleree: 0.06,
    consigne:
      "Horizon : POSITION. Ta thèse est macro ou fondamentale ; l'analyse technique ne sert qu'à choisir le moment d'entrer et le niveau d'invalidation. Tu portes des semaines de frais de portage : un différentiel de taux défavorable peut annuler un mouvement correct, vérifie-le avant d'ouvrir. Une thèse ne se réévalue pas parce que le prix a bougé, elle se réévalue quand un fait nouveau la contredit — dis lequel invaliderait la tienne.",
  },
};

export function profilHorizon(horizon: Horizon): ProfilHorizon {
  return PROFILS_HORIZON[horizon];
}

export interface ViabiliteHorizon {
  readonly horizon: Horizon;
  /** Coût complet d'un aller-retour d'un lot, dans la devise du compte. */
  readonly coutAllerRetour: number;
  /** Gain brut d'un trade atteignant sa cible, même unité. */
  readonly gainBrutAttendu: number;
  /** Part du gain brut absorbée par les frais, entre 0 et 1. */
  readonly partCouts: number;
  readonly viable: boolean;
  readonly explication: string;
}

/**
 * L'horizon est-il praticable sur cet instrument ?
 *
 * On compare ce que coûte un aller-retour à ce que rapporte un trade qui
 * atteint sa cible. Si les frais absorbent l'essentiel du gain, aucune finesse
 * d'analyse ne rattrape l'arithmétique : il faut changer d'horizon ou
 * d'instrument.
 *
 * Le calcul est volontairement pessimiste — swap au taux le plus défavorable
 * des deux sens, aucune hypothèse de remplissage favorable. Un contrôle de
 * viabilité optimiste ne protège de rien.
 */
export function evaluerViabilite(
  horizon: Horizon,
  instrument: Instrument,
  atr: number | null,
  tauxCotationVersCompte: number,
): ViabiliteHorizon {
  const profil = PROFILS_HORIZON[horizon];

  if (atr === null || !(atr > 0) || !(tauxCotationVersCompte > 0)) {
    return {
      horizon,
      coutAllerRetour: 0,
      gainBrutAttendu: 0,
      partCouts: 1,
      viable: false,
      explication:
        'Volatilité inconnue : impossible de dire si le mouvement visé couvre les frais. On ne tranche pas au hasard.',
    };
  }

  // Spread payé une fois sur l'aller-retour : on entre à un bord de la
  // fourchette et on sort à l'autre.
  const coutSpread =
    instrument.spreadDefautPoints * valeurPoint(instrument) * tauxCotationVersCompte;
  const coutCommission = commission(instrument, 1) * 2;

  // Sens le plus défavorable : un horizon n'est pas viable seulement à l'achat.
  const pointsSwap = Math.min(instrument.swapLongPoints, instrument.swapCourtPoints);
  const coutSwap =
    pointsSwap < 0
      ? Math.abs(pointsSwap) *
        valeurPoint(instrument) *
        profil.nuitsPortees *
        tauxCotationVersCompte
      : 0;

  const coutAllerRetour = coutSpread + coutCommission + coutSwap;
  const gainBrutAttendu =
    profil.multipleCibleAtr * atr * instrument.tailleContrat * tauxCotationVersCompte;

  const partCouts = gainBrutAttendu > 0 ? coutAllerRetour / gainBrutAttendu : 1;
  const viable = partCouts <= profil.partCoutsToleree;

  return {
    horizon,
    coutAllerRetour,
    gainBrutAttendu,
    partCouts,
    viable,
    explication: viable
      ? `Les frais représentent ${pourcentage(partCouts)} du gain visé — sous le seuil de ${pourcentage(profil.partCoutsToleree)} pour cet horizon.`
      : `Les frais représentent ${pourcentage(partCouts)} du gain visé, au-delà du seuil de ${pourcentage(profil.partCoutsToleree)}. ` +
        `Sur ${instrument.code}, ${profil.nom.toLowerCase()} ne peut pas payer son aller-retour : ${conseil(horizon)}`,
  };
}

/** Le meilleur horizon praticable sur un instrument, du plus court au plus long. */
export function horizonsViables(
  instrument: Instrument,
  atr: number | null,
  tauxCotationVersCompte: number,
): readonly ViabiliteHorizon[] {
  return HORIZONS.map((horizon) =>
    evaluerViabilite(horizon, instrument, atr, tauxCotationVersCompte),
  );
}

function conseil(horizon: Horizon): string {
  switch (horizon) {
    case 'SCALPING':
      return 'passer en intraday, ou choisir un instrument à spread plus serré.';
    case 'INTRADAY':
      return 'allonger vers le swing, où le même mouvement se paie une seule fois.';
    case 'SWING':
      return 'vérifier le différentiel de portage : c’est souvent lui qui pèse, pas le spread.';
    case 'POSITION':
      return 'un instrument dont le portage est à ce point défavorable ne se garde pas des semaines.';
  }
}

function pourcentage(fraction: number): string {
  return `${Math.round(fraction * 100)} %`;
}

/**
 * Bloc de consignes remis aux agents.
 *
 * Les quatre horizons sont décrits, pas seulement l'actif : un agent qui sait
 * ce qu'est le swing comprend mieux pourquoi on lui demande de scalper, et
 * saura dire « ce signal serait bon en swing, il ne l'est pas ici ». C'est une
 * distinction que les agents doivent pouvoir formuler.
 */
export function consignesHorizon(actif: Horizon): string {
  const profil = PROFILS_HORIZON[actif];
  const autres = HORIZONS.filter((code) => code !== actif)
    .map((code) => `- ${PROFILS_HORIZON[code].nom} : ${PROFILS_HORIZON[code].resume}`)
    .join('\n');

  return [
    'HORIZON DE TRAVAIL DE LA FIRME',
    profil.consigne,
    '',
    `Cadre chiffré : décision sur ${profil.intervalleDecision}, biais de fond sur ${profil.intervalleContexte}. ` +
      `Stop à ${profil.multipleStopAtr} ATR, cible à ${profil.multipleCibleAtr} ATR. ` +
      `Au plus ${profil.tradesMaxParJour} ouvertures par jour.`,
    '',
    'Les autres horizons existent et tu les connais ; tu ne les pratiques pas aujourd’hui :',
    autres,
    '',
    'Si un signal serait valable à un autre horizon mais pas à celui-ci, dis-le explicitement au lieu de l’adapter de force.',
  ].join('\n');
}
