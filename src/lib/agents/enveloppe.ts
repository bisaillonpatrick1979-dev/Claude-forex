import type { EtatPortefeuille } from '@/lib/execution/types';

/**
 * Enveloppe confiée aux agents — fonction pure, testée.
 *
 * L'utilisateur laisse aux agents une partie de son capital : 10 000 sur
 * 100 000, par exemple. Deux conséquences, toutes deux appliquées par du code
 * et non par une consigne de prompt :
 *
 *   1. Les pourcentages des garde-fous se calculent sur l'enveloppe. « 1 % de
 *      risque par trade » vaut alors 100, pas 1 000.
 *   2. La marge immobilisée par les positions d'agents ne peut pas dépasser
 *      l'enveloppe. Au-delà, l'ouverture est refusée.
 *
 * Ce n'est pas un sous-compte comptable : le solde, l'équité et la marge
 * restent ceux du portefeuille unique. C'est un plafond d'engagement et une
 * base de calcul. La nuance compte : une perte des agents réduit l'équité
 * globale, donc l'enveloppe disponible, mais n'ouvre pas un second grand livre.
 */

export interface ResultatAgents {
  /** Montant confié par l'utilisateur. */
  readonly alloue: number;
  /** Somme des P&L réalisés sur les positions fermées d'origine agent. */
  readonly profitsRealises: number;
  /** Somme des pertes réalisées, en valeur positive. */
  readonly pertesRealisees: number;
  /** P&L latent des positions d'agents encore ouvertes. */
  readonly latent: number;
  /** Marge actuellement immobilisée par les positions d'agents. */
  readonly margeEngagee: number;
}

export interface EnveloppeAgents extends ResultatAgents {
  /** Réalisé net : profits moins pertes. */
  readonly netRealise: number;
  /** Valeur courante de l'enveloppe : allocation + réalisé + latent. */
  readonly valeurCourante: number;
  /** Ce qui reste engageable avant d'atteindre le plafond. */
  readonly disponible: number;
  /** Variation en pourcentage de l'allocation. `null` si rien n'est alloué —
   *  diviser par zéro produirait un « ∞ % » qui n'informe personne. */
  readonly variationPct: number | null;
  readonly actif: boolean;
}

export function calculerEnveloppe(resultat: ResultatAgents): EnveloppeAgents {
  const netRealise = resultat.profitsRealises - resultat.pertesRealisees;
  const valeurCourante = resultat.alloue + netRealise + resultat.latent;

  return {
    ...resultat,
    netRealise,
    valeurCourante,
    disponible: Math.max(0, valeurCourante - resultat.margeEngagee),
    variationPct:
      resultat.alloue > 0 ? ((netRealise + resultat.latent) / resultat.alloue) * 100 : null,
    actif: resultat.alloue > 0,
  };
}

/**
 * Portefeuille restreint, tel que les garde-fous doivent le voir pour un ordre
 * d'agent.
 *
 * On plafonne l'équité et le solde à la valeur courante de l'enveloppe, et on
 * ne retient que la marge engagée par les agents. Le sommet d'équité est
 * plafonné de la même façon, sinon le contrôle de drawdown comparerait la
 * valeur de l'enveloppe au sommet du compte entier et refuserait tout dès la
 * première allocation.
 *
 * Quand rien n'est alloué, on rend un portefeuille d'équité nulle : les
 * garde-fous refuseront alors toute ouverture, ce qui est exactement le
 * comportement voulu — pas d'allocation, pas de trading automatique.
 */
export function portefeuilleDesAgents(
  portefeuille: EtatPortefeuille,
  enveloppe: EnveloppeAgents,
): EtatPortefeuille {
  const equite = Math.max(0, Math.min(portefeuille.equite, enveloppe.valeurCourante));

  return {
    ...portefeuille,
    solde: Math.max(0, Math.min(portefeuille.solde, enveloppe.alloue + enveloppe.netRealise)),
    equite,
    margeUtilisee: enveloppe.margeEngagee,
    sommetEquite: Math.max(equite, Math.min(portefeuille.sommetEquite, enveloppe.alloue)),
  };
}

/** Message affiché quand l'enveloppe est épuisée ou absente. */
export function raisonIndisponibilite(enveloppe: EnveloppeAgents): string | null {
  if (!enveloppe.actif) {
    return 'Aucun capital confié aux agents : ils peuvent analyser et débattre, mais pas ouvrir de position. Allouez un montant dans la salle des marchés.';
  }
  if (enveloppe.valeurCourante <= 0) {
    return 'L’enveloppe confiée aux agents est épuisée. Réalimentez-la ou ramenez les agents en validation.';
  }
  return null;
}
