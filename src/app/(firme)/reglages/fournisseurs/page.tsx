import { EntetePage } from '@/composants/ui/entete-page';
import { Panneau } from '@/composants/ui/panneau';
import {
  cleFournisseurDepuisEnvironnement,
  listerClesPubliques,
  variablesReconnuesFournisseur,
} from '@/lib/marche/cles';
import { fournisseur as adaptateur } from '@/lib/marche/fournisseurs';
import { listerSymboles } from '@/lib/marche/symboles';
import { estCodeFournisseur } from '@/lib/marche/types';
import { chiffrementConfigure } from '@/lib/securite/chiffrement';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { clientServeur } from '@/lib/supabase/serveur';
import { profilAuthentifie } from '@/lib/supabase/session';

import { SondeMarche } from './sonde';
import { TableauFournisseurs, type LigneFournisseur } from './tableau';

export const metadata = { title: 'Fournisseurs — Trading Floor IA' };

export default async function PageFournisseurs() {
  const profilId = await profilAuthentifie();
  const supabase = await clientServeur();

  const { data: lignes } = await supabase
    .from('fournisseurs_donnees')
    .select(
      'code, nom, actif, quota_limite, quota_utilise, fenetre_quota, priorite_par_classe, dernier_statut, derniere_erreur, derniere_verification_le',
    )
    .order('code');

  // Les métadonnées de clés passent par le client à privilèges : la table
  // cles_api est invisible pour le navigateur, et c'est voulu.
  const admin = clientAdminOptionnel();
  const cles = admin && profilId ? await listerClesPubliques(admin, profilId) : [];
  const parService = new Map(cles.map((cle) => [cle.service, cle]));

  const fournisseurs: LigneFournisseur[] = (lignes ?? []).map((ligne) => {
    const implementation = estCodeFournisseur(ligne.code) ? adaptateur(ligne.code) : undefined;
    const cle = parService.get(ligne.code);
    const priorites =
      typeof ligne.priorite_par_classe === 'object' && ligne.priorite_par_classe !== null
        ? (ligne.priorite_par_classe as Record<string, number>)
        : {};

    return {
      code: ligne.code,
      nom: ligne.nom,
      actif: ligne.actif,
      implemente: implementation !== undefined,
      necessiteCle: implementation?.capacites().necessiteCle ?? true,
      intervalles: implementation ? [...implementation.capacites().intervalles] : [],
      indiceVisuel: cle?.indiceVisuel ?? null,
      // Une clé posée dans l'environnement de l'hébergeur fonctionne sans
      // passer par notre base : l'écran doit le dire, sinon « clé absente »
      // ferait chercher un problème inexistant.
      cleEnvironnement: cleFournisseurDepuisEnvironnement(ligne.code) !== null,
      variablesEnvironnement: variablesReconnuesFournisseur(ligne.code),
      quotaLimite: ligne.quota_limite,
      quotaUtilise: ligne.quota_utilise,
      fenetre: ligne.fenetre_quota,
      dernierStatut: ligne.dernier_statut,
      derniereErreur: ligne.derniere_erreur,
      derniereVerification: ligne.derniere_verification_le,
      priorites,
    };
  });

  const chiffrementPret = chiffrementConfigure();
  const symboles = await listerSymboles(supabase);

  return (
    <>
      <EntetePage
        titre="Fournisseurs de données"
        description="Clés API, état de connexion, quota restant et ordre de priorité par classe d’actifs."
      />

      {!admin || !chiffrementPret ? (
        <Panneau className="mb-3">
          <div className="text-sm">
            <p className="mb-2 text-alerte">Configuration serveur incomplète.</p>
            <ul className="chiffre flex flex-col gap-1 text-xs text-texte-attenue">
              {!admin ? <li>SUPABASE_SERVICE_ROLE_KEY manquante — lecture et écriture des clés API impossibles.</li> : null}
              {!chiffrementPret ? <li>CLE_CHIFFREMENT manquante ou invalide — aucune clé ne peut être chiffrée au repos.</li> : null}
            </ul>
            <p className="mt-2 text-xs text-texte-attenue">
              Le fournisseur « mock » reste utilisable sans aucune de ces variables.
            </p>
          </div>
        </Panneau>
      ) : null}

      <div className="mb-3">
        <SondeMarche symboles={symboles.map(({ code, libelle }) => ({ code, libelle }))} />
      </div>

      <TableauFournisseurs fournisseurs={fournisseurs} />
    </>
  );
}
