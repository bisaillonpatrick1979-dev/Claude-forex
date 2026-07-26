import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { clientServeur } from '@/lib/supabase/serveur';
import type { Database } from '@/types/base-de-donnees';

export const metadata = { title: 'Agents — Trading Floor IA' };

type RoleAgent = Database['public']['Enums']['role_agent'];

/** Les trois étages de la firme, dans l'ordre où ils interviennent. */
const ETAGES: readonly { titre: string; roles: readonly RoleAgent[] }[] = [
  {
    titre: 'Étage 1 — Équipe d’analyse',
    roles: [
      'ANALYSTE_TECHNIQUE',
      'ANALYSTE_MACRO',
      'ANALYSTE_FONDAMENTAL',
      'ANALYSTE_SENTIMENT',
      'ANALYSTE_VOLATILITE',
    ],
  },
  {
    titre: 'Étage 2 — Salle de recherche',
    roles: ['CHERCHEUR_HAUSSIER', 'CHERCHEUR_BAISSIER', 'DIRECTEUR_RECHERCHE'],
  },
  {
    titre: 'Étage 3 — Exécution et contrôle',
    roles: ['TRADER', 'GESTIONNAIRE_RISQUE', 'GESTIONNAIRE_PORTEFEUILLE', 'AGENT_REFLEXION'],
  },
];

export default async function PageAgents() {
  const supabase = await clientServeur();
  const { data: agents } = await supabase
    .from('agents')
    .select('id, nom, role, couleur, fournisseur_llm, modele, temperature, actif')
    .order('ordre_affichage');

  return (
    <>
      <EntetePage
        titre="Agents"
        description="Organigramme de la firme. L’édition des mandats et l’assignation des modèles arrivent en phase 4."
      />

      {!agents || agents.length === 0 ? (
        <Panneau>
          <EtatVide message="Aucun agent pour ce profil." />
        </Panneau>
      ) : (
        <div className="flex flex-col gap-3">
          {ETAGES.map((etage) => (
            <Panneau key={etage.titre} titre={etage.titre}>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {agents
                  .filter((agent) => etage.roles.includes(agent.role))
                  .map((agent) => (
                    <li
                      key={agent.id}
                      className="rounded border border-bordure bg-panneau-clair px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: agent.couleur }}
                        />
                        <span className="text-sm">{agent.nom}</span>
                        {!agent.actif ? (
                          <span className="chiffre ml-auto text-[10px] uppercase tracking-wider text-texte-attenue">
                            inactif
                          </span>
                        ) : null}
                      </div>
                      <p className="chiffre mt-1 text-[11px] text-texte-attenue">
                        {agent.fournisseur_llm} · {agent.modele} · t={agent.temperature}
                      </p>
                    </li>
                  ))}
              </ul>
            </Panneau>
          ))}
        </div>
      )}
    </>
  );
}
