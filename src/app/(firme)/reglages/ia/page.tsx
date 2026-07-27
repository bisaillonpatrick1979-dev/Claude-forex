import { EntetePage } from '@/composants/ui/entete-page';
import { Panneau } from '@/composants/ui/panneau';
import { adaptateur, FOURNISSEURS_LLM } from '@/lib/ia';
import { tarif } from '@/lib/ia/tarifs';
import { listerClesPubliques } from '@/lib/marche/cles';
import { chiffrementConfigure } from '@/lib/securite/chiffrement';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { clientServeur } from '@/lib/supabase/serveur';
import { profilAuthentifie } from '@/lib/supabase/session';

import { CartesIa, type LigneFournisseurIa } from './cartes-ia';

export const metadata = { title: 'Clés IA — Trading Floor IA' };

/**
 * Choix du fournisseur de modèles et de sa clé.
 *
 * Écran distinct de celui des fournisseurs de données : ce ne sont ni les mêmes
 * comptes, ni les mêmes factures, ni les mêmes conséquences quand une clé
 * manque. Les mélanger obligerait à lire le libellé pour savoir de quoi on
 * parle.
 */
export default async function PageClesIa() {
  const profilId = await profilAuthentifie();
  const supabase = await clientServeur();
  const clientPrivilegie = clientAdminOptionnel();

  const [cles, { data: agents }] = await Promise.all([
    profilId && clientPrivilegie
      ? listerClesPubliques(clientPrivilegie, profilId)
      : Promise.resolve([]),
    supabase.from('agents').select('fournisseur_llm').eq('profil_id', profilId ?? ''),
  ]);

  const parService = new Map(cles.map((cle) => [cle.service, cle]));
  const comptes = new Map<string, number>();
  for (const agent of agents ?? []) {
    comptes.set(agent.fournisseur_llm, (comptes.get(agent.fournisseur_llm) ?? 0) + 1);
  }

  const lignes: LigneFournisseurIa[] = FOURNISSEURS_LLM.map((code) => {
    const implementation = adaptateur(code);
    const cle = parService.get(code);

    return {
      code,
      nom: implementation.nom,
      necessiteCle: implementation.necessiteCle,
      modeles: implementation.modeles,
      indiceVisuel: cle?.indiceVisuel ?? null,
      enregistreeLe: cle?.majLe ?? null,
      agentsUtilisant: comptes.get(code) ?? 0,
      tarifs: implementation.modeles.map((modele) => {
        const grille = tarif(modele);
        return { modele, entree: grille?.entree ?? 0, sortie: grille?.sortie ?? 0 };
      }),
    };
  });

  return (
    <>
      <EntetePage
        titre="Clés IA"
        description="Le fournisseur de modèles utilisé par vos agents, et sa clé. Rien ne sort du serveur."
      />

      {!chiffrementConfigure() ? (
        <Panneau>
          <p className="text-sm text-alerte">
            <strong>CLE_CHIFFREMENT absente ou invalide côté serveur.</strong> Aucune clé ne peut
            être enregistrée : elle serait stockée en clair. Générez une valeur avec{' '}
            <code className="chiffre">openssl rand -base64 32</code> et ajoutez-la aux variables
            d’environnement, puis redéployez.
          </p>
        </Panneau>
      ) : null}

      <Panneau>
        <p className="text-sm text-texte-attenue">
          Chaque clé est chiffrée au repos (AES-256-GCM) et déchiffrée sur le serveur juste avant
          l’appel. Elle n’est jamais renvoyée au navigateur, jamais incluse dans le bundle, jamais
          journalisée : seuls les quatre derniers caractères sont affichés pour vous permettre de
          reconnaître laquelle est en place.
        </p>
        <p className="mt-2 text-sm text-texte-attenue">
          Le fournisseur se choisit agent par agent dans la console des agents ; le bouton
          « Appliquer aux 12 agents » ci-dessous bascule toute la firme d’un coup. Tant qu’aucune
          clé n’est enregistrée, les agents restent sur la simulation locale — ils délibèrent
          normalement, sans rien dépenser.
        </p>
      </Panneau>

      <CartesIa fournisseurs={lignes} />
    </>
  );
}
