import { redirect } from 'next/navigation';

import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { roleHabiliteAExecuter } from '@/lib/agents/niveaux';
import { DESCRIPTIONS_MODES } from '@/lib/config/modes';
import { clientServeur } from '@/lib/supabase/serveur';

import { BancEssai, type AgentOption } from './banc-essai';
import { ConsoleAgents, type AgentAffiche } from './console-agents';

export const metadata = { title: 'Agents — Trading Floor IA' };

/**
 * Console de gouvernance de la firme.
 *
 * L'organigramme n'est plus une liste à regarder : c'est ici qu'on décide qui
 * a le droit d'engager le portefeuille et qui doit demander la permission.
 */
export default async function PageAgents() {
  const supabase = await clientServeur();
  const { data: jetons } = await supabase.auth.getClaims();
  const profilId = jetons?.claims?.sub;
  if (typeof profilId !== 'string') redirect('/connexion');

  const [{ data: agents }, { data: profil }, { data: symboles }] = await Promise.all([
    supabase
      .from('agents')
      .select(
        `id, cle, nom, role, couleur, actif, fournisseur_llm, modele, ordre_affichage,
         permissions_agents (niveau, peut_ouvrir, peut_fermer, peut_modifier_protections,
           taille_max_lots, risque_max_par_trade_pct, trades_max_par_jour, seuil_validation_lots,
           confiance_minimale, validite_validation_minutes, classes_autorisees, symboles_autorises,
           suspendu_jusqu_a),
         mandats_agents (version, contenu, actif)`,
      )
      .eq('profil_id', profilId)
      .order('ordre_affichage'),
    supabase.from('profils').select('mode_operation').eq('id', profilId).maybeSingle(),
    supabase.from('symboles').select('code').eq('actif', true).order('code'),
  ]);

  const affiches: AgentAffiche[] = (agents ?? []).map((agent) => {
    const brut = agent.permissions_agents as unknown;
    const permission = (Array.isArray(brut) ? brut[0] : brut) as
      | {
          niveau: AgentAffiche['niveau'];
          peut_ouvrir: boolean;
          peut_fermer: boolean;
          peut_modifier_protections: boolean;
          taille_max_lots: number | null;
          risque_max_par_trade_pct: number | null;
          trades_max_par_jour: number | null;
          seuil_validation_lots: number | null;
          confiance_minimale: number | null;
          validite_validation_minutes: number;
          classes_autorisees: string[];
          symboles_autorises: string[];
          suspendu_jusqu_a: string | null;
        }
      | null
      | undefined;

    const mandat = (agent.mandats_agents ?? []).find((version) => version.actif);
    const nombreOuNull = (valeur: number | null | undefined): number | null =>
      valeur === null || valeur === undefined ? null : Number(valeur);

    return {
      id: agent.id,
      cle: agent.cle,
      nom: agent.nom,
      role: agent.role,
      couleur: agent.couleur,
      actif: agent.actif,
      fournisseur: agent.fournisseur_llm,
      modele: agent.modele,
      mandat: mandat?.contenu ?? '',
      versionMandat: mandat?.version ?? null,
      niveau: permission?.niveau ?? 'OBSERVATEUR',
      peutOuvrir: permission?.peut_ouvrir ?? false,
      peutFermer: permission?.peut_fermer ?? false,
      peutModifierProtections: permission?.peut_modifier_protections ?? false,
      tailleMaxLots: nombreOuNull(permission?.taille_max_lots),
      risqueMaxParTradePct: nombreOuNull(permission?.risque_max_par_trade_pct),
      tradesMaxParJour: permission?.trades_max_par_jour ?? null,
      seuilValidationLots: nombreOuNull(permission?.seuil_validation_lots),
      confianceMinimale: permission?.confiance_minimale ?? null,
      validiteValidationMinutes: permission?.validite_validation_minutes ?? 30,
      classesAutorisees: permission?.classes_autorisees ?? [],
      symbolesAutorises: permission?.symboles_autorises ?? [],
      suspenduJusquA: permission?.suspendu_jusqu_a ?? null,
      peutEtreAutonome: roleHabiliteAExecuter(agent.role),
    };
  });

  // Le banc d'essai ne propose que les agents qui pourraient réellement
  // soumettre : faire « tester » un analyste ne dirait rien d'utile.
  const optionsBanc: AgentOption[] = affiches
    .filter((agent) => agent.peutOuvrir || agent.peutFermer)
    .map((agent) => ({ cle: agent.cle, nom: agent.nom, niveau: agent.niveau }));

  const mode = profil?.mode_operation ?? 'PAPIER_AUTONOME';

  return (
    <>
      <EntetePage
        titre="Agents"
        description="Organigramme de la firme, autorisations de trading et mandats."
      />

      <div className="mb-3">
        <Panneau titre="Mode d’opération">
          <p className="text-xs text-texte-attenue">
            <span className="text-texte">{DESCRIPTIONS_MODES[mode].libelle}</span> —{' '}
            {DESCRIPTIONS_MODES[mode].description}
            {mode !== 'PAPIER_AUTONOME' ? (
              <>
                {' '}
                Tant que ce mode est actif, il prime sur les niveaux ci-dessous :{' '}
                {mode === 'PAPIER_CONSEIL'
                  ? 'aucun agent ne peut soumettre d’ordre.'
                  : 'aucun agent n’exécute sans votre validation.'}
              </>
            ) : null}
          </p>
        </Panneau>
      </div>

      {affiches.length === 0 ? (
        <Panneau>
          <EtatVide message="Aucun agent pour ce profil." />
        </Panneau>
      ) : (
        <div className="flex flex-col gap-3">
          <ConsoleAgents agents={affiches} />
          <BancEssai
            agents={optionsBanc}
            symboles={(symboles ?? []).map((symbole) => symbole.code)}
          />
        </div>
      )}
    </>
  );
}
