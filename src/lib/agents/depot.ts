import type { ClientAdmin } from '@/lib/execution/contexte-serveur';
import type { ClasseActif } from '@/lib/marche/types';
import { debutJourneeLocale, FUSEAU_DEFAUT } from '@/lib/temps/journee';

import type { PermissionAgent } from './permissions';
import type { RoleAgent } from './niveaux';

/**
 * Lecture serveur des agents et de leurs permissions.
 *
 * Le mapping colonne → champ TypeScript est isolé ici : la fonction pure
 * `evaluerPermission` ne doit jamais voir une ligne de base, et les actions ne
 * doivent jamais recopier ce mapping.
 */

export interface AgentCharge {
  readonly id: string;
  readonly cle: string;
  readonly nom: string;
  readonly role: RoleAgent;
  readonly actif: boolean;
  readonly permission: PermissionAgent;
}

type LignePermission = {
  niveau: PermissionAgent['niveau'];
  peut_ouvrir: boolean;
  peut_fermer: boolean;
  peut_modifier_protections: boolean;
  taille_max_lots: number | null;
  risque_max_par_trade_pct: number | null;
  trades_max_par_jour: number | null;
  classes_autorisees: ClasseActif[];
  symboles_autorises: string[];
  seuil_validation_lots: number | null;
  confiance_minimale: number | null;
  validite_validation_minutes: number;
  suspendu_jusqu_a: string | null;
  raison_suspension: string | null;
};

const CHAMPS_PERMISSION =
  'niveau, peut_ouvrir, peut_fermer, peut_modifier_protections, taille_max_lots, ' +
  'risque_max_par_trade_pct, trades_max_par_jour, classes_autorisees, symboles_autorises, ' +
  'seuil_validation_lots, confiance_minimale, validite_validation_minutes, ' +
  'suspendu_jusqu_a, raison_suspension';

/**
 * Défaut appliqué quand un agent n'a pas encore de ligne de permission — cas
 * qui ne devrait plus exister depuis le trigger `agents_permissions_par_defaut`,
 * mais dont l'absence ne doit jamais se traduire par une permission implicite :
 * pas de ligne, pas de droits.
 */
export const PERMISSION_FERMEE: PermissionAgent = {
  niveau: 'OBSERVATEUR',
  peutOuvrir: false,
  peutFermer: false,
  peutModifierProtections: false,
  tailleMaxLots: null,
  risqueMaxParTradePct: null,
  tradesMaxParJour: null,
  classesAutorisees: [],
  symbolesAutorises: [],
  seuilValidationLots: null,
  confianceMinimale: null,
  validiteValidationMinutes: 30,
  suspenduJusquA: null,
  raisonSuspension: null,
};

export function permissionDepuisLigne(ligne: LignePermission | null | undefined): PermissionAgent {
  if (!ligne) return PERMISSION_FERMEE;

  const nombreOuNull = (valeur: number | null): number | null =>
    valeur === null ? null : Number(valeur);

  return {
    niveau: ligne.niveau,
    peutOuvrir: ligne.peut_ouvrir,
    peutFermer: ligne.peut_fermer,
    peutModifierProtections: ligne.peut_modifier_protections,
    tailleMaxLots: nombreOuNull(ligne.taille_max_lots),
    risqueMaxParTradePct: nombreOuNull(ligne.risque_max_par_trade_pct),
    tradesMaxParJour: ligne.trades_max_par_jour,
    classesAutorisees: ligne.classes_autorisees ?? [],
    symbolesAutorises: ligne.symboles_autorises ?? [],
    seuilValidationLots: nombreOuNull(ligne.seuil_validation_lots),
    confianceMinimale: ligne.confiance_minimale,
    validiteValidationMinutes: ligne.validite_validation_minutes,
    suspenduJusquA:
      ligne.suspendu_jusqu_a === null
        ? null
        : Math.floor(new Date(ligne.suspendu_jusqu_a).getTime() / 1000),
    raisonSuspension: ligne.raison_suspension,
  };
}

export async function chargerAgentParCle(
  client: ClientAdmin,
  profilId: string,
  cle: string,
): Promise<AgentCharge | null> {
  const { data } = await client
    .from('agents')
    .select(`id, cle, nom, role, actif, permissions_agents (${CHAMPS_PERMISSION})`)
    .eq('profil_id', profilId)
    .eq('cle', cle)
    .maybeSingle();

  if (!data) return null;

  // La relation est un un-à-un côté schéma (contrainte unique sur agent_id),
  // mais PostgREST la rend sous forme de tableau ou d'objet selon la version :
  // on normalise ici plutôt que de faire confiance à la forme reçue.
  const brut = data.permissions_agents as unknown;
  const ligne = (Array.isArray(brut) ? brut[0] : brut) as LignePermission | null;

  return {
    id: data.id,
    cle: data.cle,
    nom: data.nom,
    role: data.role,
    actif: data.actif,
    permission: permissionDepuisLigne(ligne),
  };
}

/**
 * Ordres déjà acceptés pour cet agent depuis le début de la journée locale.
 *
 * Compté sur les propositions acceptées et non sur les ordres : un ordre
 * annulé avant remplissage a quand même consommé une décision de l'agent, et
 * c'est bien le nombre de décisions qu'on plafonne.
 *
 * La journée est celle du fuseau du profil. Calée sur l'UTC, elle remettait le
 * quota à zéro à 18 h en Alberta — un agent limité à trois trades par jour
 * pouvait en placer six entre midi et minuit.
 */
export async function compterTradesDuJour(
  client: ClientAdmin,
  profilId: string,
  agentId: string,
  maintenant: Date,
  fuseau: string = FUSEAU_DEFAUT,
): Promise<number> {
  const debutJournee = debutJourneeLocale(fuseau, maintenant);

  const { count } = await client
    .from('propositions_ordres')
    .select('id', { count: 'exact', head: true })
    .eq('profil_id', profilId)
    .eq('agent_id', agentId)
    .eq('statut', 'ACCEPTEE')
    .gte('cree_le', debutJournee.toISOString());

  return count ?? 0;
}
