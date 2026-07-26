import type { ModeOperation } from '@/lib/config/drapeaux';
import type { ClasseActif } from '@/lib/marche/types';
import type { ParametresRisque } from '@/lib/risque/garde-fous';

import type { NiveauAutonomie, RoleAgent } from './niveaux';
import { roleHabiliteAExecuter } from './niveaux';

/**
 * Permissions des agents — fonction pure, testée, appelée avant toute action
 * d'agent sur le portefeuille.
 *
 * Deux barrières successives, jamais interchangeables :
 *
 *   1. `evaluerPermission` — cet agent-là a-t-il le droit d'agir, et faut-il
 *      une validation humaine ? C'est ce fichier.
 *   2. `evaluerGardeFous`  — quelle taille le portefeuille peut supporter ?
 *      C'est `lib/risque/garde-fous.ts`.
 *
 * La première ne connaît rien au risque de marché, la seconde ne connaît rien
 * aux agents. Un agent autonome reste soumis aux garde-fous ; un agent bridé
 * par les garde-fous n'obtient pas d'autonomie pour autant.
 *
 * Comme les garde-fous, cette fonction ne lit ni la base ni l'heure système :
 * tout entre par paramètre, tout est reproductible en test.
 */

export type ActionAgent = 'OUVERTURE' | 'FERMETURE' | 'MODIFICATION_PROTECTIONS';

export interface PermissionAgent {
  readonly niveau: NiveauAutonomie;
  readonly peutOuvrir: boolean;
  readonly peutFermer: boolean;
  readonly peutModifierProtections: boolean;
  /** `null` = pas de plafond propre à l'agent. */
  readonly tailleMaxLots: number | null;
  readonly risqueMaxParTradePct: number | null;
  readonly tradesMaxParJour: number | null;
  /** Vide = aucune restriction de périmètre. */
  readonly classesAutorisees: readonly ClasseActif[];
  readonly symbolesAutorises: readonly string[];
  /** Au-delà, un agent autonome repasse par une validation humaine. */
  readonly seuilValidationLots: number | null;
  readonly confianceMinimale: number | null;
  readonly validiteValidationMinutes: number;
  /** Secondes depuis l'époque, ou `null` si l'agent n'est pas suspendu. */
  readonly suspenduJusquA: number | null;
  readonly raisonSuspension: string | null;
}

export interface DemandeAgent {
  readonly action: ActionAgent;
  readonly symbole: string;
  readonly classeActif: ClasseActif;
  /** Nombre de lots demandé ; 0 pour une action sans taille. */
  readonly quantite: number;
  /** Degré de confiance annoncé par l'agent, de 0 à 100. */
  readonly confiance: number | null;
}

export interface ContextePermission {
  readonly role: RoleAgent;
  readonly agentActif: boolean;
  readonly modeOperation: ModeOperation;
  readonly portefeuilleGele: boolean;
  /** Ordres déjà acceptés pour cet agent depuis le début de la journée UTC. */
  readonly tradesAujourdHui: number;
  /** Secondes depuis l'époque. */
  readonly maintenant: number;
}

export type VerdictPermission = 'AUTONOME' | 'VALIDATION_REQUISE' | 'REFUSE';

export interface ControlePermission {
  readonly code: string;
  readonly libelle: string;
  readonly statut: 'OK' | 'REDUIT' | 'REFUSE' | 'VALIDATION';
  readonly detail: string;
}

export interface DecisionPermission {
  readonly verdict: VerdictPermission;
  /** Taille retenue après application du plafond propre à l'agent. */
  readonly quantiteAutorisee: number;
  readonly raison: string;
  readonly controles: readonly ControlePermission[];
  /** Secondes depuis l'époque, renseigné quand une validation est attendue. */
  readonly expireLe: number | null;
}

/** Sous ce seuil, la taille résiduelle ne vaut plus la peine d'être exécutée.
 *  Même valeur que dans les garde-fous, pour ne pas produire deux verdicts
 *  contradictoires sur une même taille. */
const QUANTITE_MINIMALE_LOTS = 0.01;

/**
 * Un mode de profil ne peut que resserrer. `PAPIER_AUTONOME` laisse les
 * permissions décider agent par agent ; tout autre mode impose la validation
 * humaine, quelle que soit la configuration des agents. `PAPIER_CONSEIL`, lui,
 * ne se contente pas de resserrer : il retire aux agents le droit de soumettre.
 */
function modeImposeValidation(mode: ModeOperation): boolean {
  return mode !== 'PAPIER_AUTONOME';
}

/**
 * Fusion des plafonds de risque : le plus strict des deux gagne.
 *
 * Une permission d'agent ne peut jamais élargir les limites du portefeuille —
 * sinon la table des permissions deviendrait un contournement des garde-fous,
 * accessible depuis le navigateur par la policy RLS.
 */
export function fusionnerRisque(
  parametres: ParametresRisque,
  permission: Pick<PermissionAgent, 'risqueMaxParTradePct'>,
): ParametresRisque {
  if (permission.risqueMaxParTradePct === null) return parametres;
  return {
    ...parametres,
    risqueMaxParTradePct: Math.min(
      parametres.risqueMaxParTradePct,
      permission.risqueMaxParTradePct,
    ),
  };
}

export function evaluerPermission(
  demande: DemandeAgent,
  permission: PermissionAgent,
  contexte: ContextePermission,
): DecisionPermission {
  const controles: ControlePermission[] = [];

  const refuser = (code: string, libelle: string, detail: string): DecisionPermission => {
    controles.push({ code, libelle, statut: 'REFUSE', detail });
    return { verdict: 'REFUSE', quantiteAutorisee: 0, raison: detail, controles, expireLe: null };
  };

  // --- Refus francs --------------------------------------------------------

  if (contexte.portefeuilleGele) {
    return refuser(
      'GEL',
      'Portefeuille gelé',
      'Le portefeuille est gelé (kill switch) : aucun agent n’agit.',
    );
  }

  if (!contexte.agentActif) {
    return refuser('AGENT_INACTIF', 'Agent inactif', 'Cet agent est désactivé.');
  }

  if (permission.suspenduJusquA !== null && permission.suspenduJusquA > contexte.maintenant) {
    const restant = Math.ceil((permission.suspenduJusquA - contexte.maintenant) / 60);
    return refuser(
      'SUSPENDU',
      'Agent suspendu',
      `Agent suspendu encore ${restant} min${permission.raisonSuspension ? ` : ${permission.raisonSuspension}` : '.'}`,
    );
  }

  // Le mode conseil n'est pas une validation plus stricte, c'est un retrait du
  // droit de soumettre : les agents conseillent, l'humain trade. Mettre ces
  // ordres en file d'attente laisserait croire qu'ils sont exécutables.
  if (contexte.modeOperation === 'PAPIER_CONSEIL') {
    return refuser(
      'MODE_CONSEIL',
      'Mode conseil',
      'Mode conseil : les agents analysent et conseillent, ils ne soumettent aucun ordre.',
    );
  }

  if (permission.niveau === 'OBSERVATEUR') {
    return refuser(
      'NIVEAU',
      'Niveau d’autonomie',
      'Agent en observateur : il analyse et débat, il n’agit pas sur le portefeuille.',
    );
  }
  controles.push({
    code: 'NIVEAU',
    libelle: 'Niveau d’autonomie',
    statut: 'OK',
    detail: permission.niveau,
  });

  const droitAccorde =
    demande.action === 'OUVERTURE'
      ? permission.peutOuvrir
      : demande.action === 'FERMETURE'
        ? permission.peutFermer
        : permission.peutModifierProtections;

  if (!droitAccorde) {
    const libelles: Record<ActionAgent, string> = {
      OUVERTURE: 'ouvrir une position',
      FERMETURE: 'fermer une position',
      MODIFICATION_PROTECTIONS: 'déplacer un stop ou un objectif',
    };
    return refuser(
      'DROIT_ACTION',
      'Droit d’action',
      `Cet agent n’a pas le droit de ${libelles[demande.action]}.`,
    );
  }
  controles.push({
    code: 'DROIT_ACTION',
    libelle: 'Droit d’action',
    statut: 'OK',
    detail: demande.action,
  });

  if (
    permission.classesAutorisees.length > 0 &&
    !permission.classesAutorisees.includes(demande.classeActif)
  ) {
    return refuser(
      'PERIMETRE_CLASSE',
      'Classe d’actifs',
      `Classe ${demande.classeActif} hors du périmètre de cet agent (${permission.classesAutorisees.join(', ')}).`,
    );
  }

  if (
    permission.symbolesAutorises.length > 0 &&
    !permission.symbolesAutorises.includes(demande.symbole)
  ) {
    return refuser(
      'PERIMETRE_SYMBOLE',
      'Instrument',
      `${demande.symbole} hors du périmètre de cet agent (${permission.symbolesAutorises.join(', ')}).`,
    );
  }
  controles.push({
    code: 'PERIMETRE',
    libelle: 'Périmètre',
    statut: 'OK',
    detail:
      permission.classesAutorisees.length === 0 && permission.symbolesAutorises.length === 0
        ? 'Aucune restriction'
        : `${demande.symbole} autorisé`,
  });

  // Le quota du jour ne compte que les ouvertures : interdire une fermeture
  // parce que le quota est atteint laisserait une position ouverte sans
  // personne pour la refermer.
  if (
    demande.action === 'OUVERTURE' &&
    permission.tradesMaxParJour !== null &&
    contexte.tradesAujourdHui >= permission.tradesMaxParJour
  ) {
    return refuser(
      'QUOTA_JOUR',
      'Trades par jour',
      `Quota atteint : ${contexte.tradesAujourdHui} / ${permission.tradesMaxParJour} ordres acceptés aujourd’hui.`,
    );
  }
  if (permission.tradesMaxParJour !== null) {
    controles.push({
      code: 'QUOTA_JOUR',
      libelle: 'Trades par jour',
      statut: 'OK',
      detail: `${contexte.tradesAujourdHui} / ${permission.tradesMaxParJour}`,
    });
  }

  if (
    permission.confianceMinimale !== null &&
    demande.action === 'OUVERTURE' &&
    (demande.confiance === null || demande.confiance < permission.confianceMinimale)
  ) {
    return refuser(
      'CONFIANCE',
      'Confiance minimale',
      demande.confiance === null
        ? `Proposition sans degré de confiance, alors que ${permission.confianceMinimale} est exigé.`
        : `Confiance ${demande.confiance} sous le minimum exigé de ${permission.confianceMinimale}.`,
    );
  }

  // --- Plafond de taille propre à l'agent ---------------------------------

  let quantite = demande.quantite;
  let reduite = false;

  if (permission.tailleMaxLots !== null && quantite > permission.tailleMaxLots) {
    quantite = permission.tailleMaxLots;
    reduite = true;
    controles.push({
      code: 'TAILLE_AGENT',
      libelle: 'Taille maximale de l’agent',
      statut: 'REDUIT',
      detail: `${demande.quantite} → ${quantite} lot(s) (plafond de l’agent).`,
    });
  } else if (permission.tailleMaxLots !== null) {
    controles.push({
      code: 'TAILLE_AGENT',
      libelle: 'Taille maximale de l’agent',
      statut: 'OK',
      detail: `${quantite} / ${permission.tailleMaxLots} lot(s)`,
    });
  }

  if (demande.action !== 'MODIFICATION_PROTECTIONS' && quantite < QUANTITE_MINIMALE_LOTS) {
    return refuser(
      'TAILLE_MINIMALE',
      'Taille résiduelle nulle',
      `Taille autorisée de ${quantite} lot après plafonnement : action refusée.`,
    );
  }

  // --- Autonome ou validation humaine -------------------------------------

  const expireLe = contexte.maintenant + permission.validiteValidationMinutes * 60;

  const validation = (code: string, libelle: string, detail: string): DecisionPermission => {
    controles.push({ code, libelle, statut: 'VALIDATION', detail });
    return {
      verdict: 'VALIDATION_REQUISE',
      quantiteAutorisee: quantite,
      raison: detail,
      controles,
      expireLe,
    };
  };

  if (permission.niveau === 'PROPOSITION') {
    return validation(
      'NIVEAU',
      'Niveau d’autonomie',
      'Agent en proposition : l’ordre attend votre validation.',
    );
  }

  // Ceinture et bretelles : le trigger en base refuse déjà l'autonomie aux
  // rôles non exécutants. Si une ligne y échappait, elle vaudrait proposition,
  // jamais exécution directe.
  if (!roleHabiliteAExecuter(contexte.role)) {
    return validation(
      'ROLE',
      'Rôle non exécutant',
      `Le rôle ${contexte.role} n’exécute pas d’ordre : la proposition passe par votre validation.`,
    );
  }

  if (modeImposeValidation(contexte.modeOperation)) {
    return validation(
      'MODE',
      'Mode d’opération',
      `Mode ${contexte.modeOperation} : toute exécution passe par votre validation, quel que soit le niveau de l’agent.`,
    );
  }

  if (permission.seuilValidationLots !== null && quantite > permission.seuilValidationLots) {
    return validation(
      'SEUIL_VALIDATION',
      'Seuil de validation',
      `${quantite} lot(s) au-dessus du seuil d’autonomie de ${permission.seuilValidationLots} : validation demandée.`,
    );
  }

  controles.push({
    code: 'AUTONOMIE',
    libelle: 'Exécution autonome',
    statut: 'OK',
    detail:
      permission.seuilValidationLots === null
        ? 'Agent autonome, sans seuil de validation.'
        : `${quantite} / ${permission.seuilValidationLots} lot(s) sous le seuil de validation.`,
  });

  return {
    verdict: 'AUTONOME',
    quantiteAutorisee: quantite,
    raison: reduite
      ? `Exécution autonome, taille ramenée à ${quantite} lot(s) par le plafond de l’agent.`
      : 'Exécution autonome autorisée.',
    controles,
    expireLe: null,
  };
}
