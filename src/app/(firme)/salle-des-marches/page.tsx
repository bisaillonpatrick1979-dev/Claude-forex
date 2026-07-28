import { redirect } from 'next/navigation';

import { PanneauEnveloppe } from '@/composants/agents/panneau-enveloppe';
import { Atelier } from '@/composants/trading/atelier';
import type { PlacementAffiche } from '@/composants/trading/placements';
import type { OrdreAffiche, PositionAffichee } from '@/composants/trading/positions-ouvertes';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { couleurPnl, formaterMonnaie, formaterPourcentage, versNombre } from '@/lib/format';
import { listerSymboles } from '@/lib/marche/symboles';
import { raisonIndisponibilite } from '@/lib/agents/enveloppe';
import { chargerEnveloppe } from '@/lib/agents/enveloppe-serveur';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { seancesOuvertes } from '@/lib/marche/seances-mondiales';
import { chargerSourcesMarqueurs } from '@/lib/orchestration/marqueurs-serveur';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Salle des marchés — Trading Floor IA' };

/**
 * Écran principal, en trois zones sur grand écran et empilé sur tablette.
 * Les chiffres viennent tous de la base : rien n'est simulé côté affichage.
 */
export default async function PageSalleDesMarches() {
  const supabase = await clientServeur();
  const { data: jetons } = await supabase.auth.getClaims();
  const profilId = jetons?.claims?.sub;
  if (typeof profilId !== 'string') redirect('/connexion');

  const [
    { data: portefeuille },
    symboles,
    { data: positions },
    { data: ordres },
    { data: profil },
    { data: agents },
    { count: agentsAutonomes },
    { data: perimetres },
  ] = await Promise.all([
      supabase
        .from('portefeuilles')
        .select('nom, devise, capital_initial, solde, equite, marge_utilisee, sommet_equite, gele, raison_gel, capital_alloue_agents, rejeu_actif, rejeu_symbole, rejeu_intervalle, rejeu_debut, rejeu_curseur, rejeu_fin, rejeu_source')
        .eq('profil_id', profilId)
        .limit(1)
        .maybeSingle(),
      listerSymboles(supabase),
      supabase
        .from('positions')
        .select('id, sens, quantite, prix_entree, stop_loss, take_profit, ouvert_le, symboles(code, decimales, taille_contrat)')
        .eq('profil_id', profilId)
        .eq('statut', 'OUVERTE')
        .order('ouvert_le', { ascending: false }),
      supabase
        .from('ordres')
        .select('id, sens, type_ordre, quantite, prix_demande, statut, symboles(code)')
        .eq('profil_id', profilId)
        .in('statut', ['EN_ATTENTE', 'PARTIELLEMENT_REMPLI'])
        .order('cree_le', { ascending: false }),
      supabase.from('profils').select('mode_operation, seances_agents').eq('id', profilId).maybeSingle(),
      supabase
        .from('agents')
        .select('id, nom, couleur')
        .eq('profil_id', profilId)
        .order('ordre_affichage'),
      supabase
        .from('permissions_agents')
        .select('agent_id', { count: 'exact', head: true })
        .eq('profil_id', profilId)
        .eq('niveau', 'AUTONOME'),
      supabase.from('permissions_agents').select('classes_autorisees').eq('profil_id', profilId),
    ]);

  const sourcesMarqueurs = await chargerSourcesMarqueurs(supabase, profilId);

  const equite = versNombre(portefeuille?.equite);
  const capitalInitial = versNombre(portefeuille?.capital_initial);
  const sommet = versNombre(portefeuille?.sommet_equite);
  const devise = portefeuille?.devise ?? 'USD';

  // Journal des placements : positions ouvertes d'abord, puis les fermetures
  // les plus récentes. Le raisonnement vient de la proposition d'origine quand
  // la position est née d'une décision d'agent.
  const { data: lignesPlacements } = await supabase
    .from('positions')
    .select(
      'id, sens, quantite, prix_entree, prix_sortie, stop_loss, take_profit, pnl_realise, pnl_latent, statut, motif_sortie, origine, ouvert_le, ferme_le, symboles(code, decimales, classe_actif), ordres(propositions_ordres(raisonnement))',
    )
    .eq('profil_id', profilId)
    .order('statut', { ascending: true })
    .order('ouvert_le', { ascending: false })
    .limit(60);

  const placements: PlacementAffiche[] = (lignesPlacements ?? []).map((ligne) => {
    const proposition = Array.isArray(ligne.ordres)
      ? ligne.ordres[0]?.propositions_ordres
      : (ligne.ordres as { propositions_ordres?: unknown } | null)?.propositions_ordres;
    const raisonnement = Array.isArray(proposition)
      ? (proposition[0] as { raisonnement?: string } | undefined)?.raisonnement
      : (proposition as { raisonnement?: string } | null)?.raisonnement;

    return {
      id: ligne.id,
      symbole: ligne.symboles?.code ?? '—',
      classeActif: ligne.symboles?.classe_actif ?? '—',
      sens: ligne.sens,
      quantite: Number(ligne.quantite),
      prixEntree: Number(ligne.prix_entree),
      prixSortie: ligne.prix_sortie === null ? null : Number(ligne.prix_sortie),
      stopLoss: ligne.stop_loss === null ? null : Number(ligne.stop_loss),
      takeProfit: ligne.take_profit === null ? null : Number(ligne.take_profit),
      pnlRealise: ligne.pnl_realise === null ? null : Number(ligne.pnl_realise),
      pnlLatent: Number(ligne.pnl_latent ?? 0),
      statut: ligne.statut,
      motif: ligne.motif_sortie,
      origine: ligne.origine,
      ouvertLe: ligne.ouvert_le,
      fermeLe: ligne.ferme_le,
      decimales: ligne.symboles?.decimales ?? 5,
      devise,
      raisonnement: raisonnement ?? null,
    };
  });

  // L'enveloppe passe par le client à privilèges : elle agrège des positions
  // fermées que RLS laisse lire, mais le calcul doit rester identique à celui
  // qu'appliquent les barrières côté serveur — une seule implémentation.
  const clientPrivilegie = clientAdminOptionnel();
  const enveloppe = clientPrivilegie
    ? await chargerEnveloppe(clientPrivilegie, profilId)
    : null;


  // Décomposition exacte, pas une approximation : par construction du moteur,
  // le solde ne contient que du réalisé et l'équité vaut solde + latent. Les
  // afficher séparément permet de recouper avec le journal des placements —
  // un total unique ne se vérifie pas.
  const solde = versNombre(portefeuille?.solde);
  const pnlRealise = solde !== null && capitalInitial !== null ? solde - capitalInitial : null;
  const pnlLatentTotal = equite !== null && solde !== null ? equite - solde : null;

  const pnlCumule = equite !== null && capitalInitial !== null ? equite - capitalInitial : null;
  const pnlCumulePct =
    pnlCumule !== null && capitalInitial ? (pnlCumule / capitalInitial) * 100 : null;
  const drawdownPct = equite !== null && sommet ? ((sommet - equite) / sommet) * 100 : null;

  const positionsAffichees: PositionAffichee[] = (positions ?? []).map((ligne) => ({
    id: ligne.id,
    symbole: ligne.symboles?.code ?? '—',
    sens: ligne.sens,
    quantite: Number(ligne.quantite),
    ouvertLe: Math.floor(new Date(ligne.ouvert_le).getTime() / 1000),
    prixEntree: Number(ligne.prix_entree),
    stopLoss: ligne.stop_loss === null ? null : Number(ligne.stop_loss),
    takeProfit: ligne.take_profit === null ? null : Number(ligne.take_profit),
    tailleContrat: Number(ligne.symboles?.taille_contrat ?? 1),
    decimales: ligne.symboles?.decimales ?? 5,
  }));

  const ordresAffiches: OrdreAffiche[] = (ordres ?? []).map((ligne) => ({
    id: ligne.id,
    symbole: ligne.symboles?.code ?? '—',
    sens: ligne.sens,
    type: ligne.type_ordre,
    quantite: Number(ligne.quantite),
    prixDemande: ligne.prix_demande === null ? null : Number(ligne.prix_demande),
    statut: ligne.statut,
  }));

  const panneauFirme = (
    <Panneau titre={portefeuille?.nom ?? 'Portefeuille'}>
      {portefeuille ? (
        <dl className="flex flex-col gap-2 text-sm">
          <Ligne libelle="Équité" valeur={formaterMonnaie(equite, devise)} />
          <Ligne libelle="Solde (réalisé)" valeur={formaterMonnaie(solde, devise)} />
          <Ligne
            libelle="Gains/pertes réalisés"
            valeur={formaterMonnaie(pnlRealise, devise)}
            classeValeur={couleurPnl(pnlRealise)}
          />
          <Ligne
            libelle="Latent (positions ouvertes)"
            valeur={formaterMonnaie(pnlLatentTotal, devise)}
            classeValeur={couleurPnl(pnlLatentTotal)}
          />
          <Ligne
            libelle="P&L cumulé"
            valeur={formaterMonnaie(pnlCumule, devise)}
            classeValeur={couleurPnl(pnlCumule)}
          />
          <Ligne
            libelle="P&L cumulé %"
            valeur={formaterPourcentage(pnlCumulePct)}
            classeValeur={couleurPnl(pnlCumule)}
          />
          <Ligne
            libelle="Marge utilisée"
            valeur={formaterMonnaie(versNombre(portefeuille.marge_utilisee), devise)}
          />
          <Ligne libelle="Drawdown" valeur={formaterPourcentage(drawdownPct)} />
          {portefeuille.gele ? (
            <p className="rounded border border-baisse/40 bg-baisse/10 px-2 py-1 text-xs text-baisse">
              Portefeuille gelé — {portefeuille.raison_gel ?? 'kill switch'}
            </p>
          ) : null}
        </dl>
      ) : (
        <EtatVide message="Aucun portefeuille rattaché à ce profil." />
      )}
    </Panneau>
  );

  const panneauAgents = (
    <Panneau titre="Vos agents">
      {enveloppe ? (
        <PanneauEnveloppe
          enveloppe={{
            alloue: enveloppe.alloue,
            profitsRealises: enveloppe.profitsRealises,
            pertesRealisees: enveloppe.pertesRealisees,
            latent: enveloppe.latent,
            valeurCourante: enveloppe.valeurCourante,
            netRealise: enveloppe.netRealise,
            variationPct: enveloppe.variationPct,
            margeEngagee: enveloppe.margeEngagee,
          }}
          devise={devise}
          equiteCompte={equite}
          modeOperation={profil?.mode_operation ?? 'PAPIER_VALIDATION'}
          agentsAutonomes={agentsAutonomes ?? 0}
          classesAutorisees={[
            ...new Set((perimetres ?? []).flatMap((ligne) => ligne.classes_autorisees ?? [])),
          ]}
          seancesAutorisees={profil?.seances_agents ?? []}
          seancesOuvertesMaintenant={seancesOuvertes(Math.floor(Date.now() / 1000))}
        />
      ) : (
        <EtatVide message="SUPABASE_SERVICE_ROLE_KEY absente : l’enveloppe des agents ne peut pas être calculée." />
      )}
    </Panneau>
  );

  return (
    <Atelier
      instantInitial={Math.floor(Date.now() / 1000)}
      symboles={symboles}
      positions={positionsAffichees}
      ordres={ordresAffiches}
      sourcesMarqueurs={sourcesMarqueurs}
      placements={placements}
      panneauFirme={panneauFirme}
      panneauAgents={panneauAgents}
      profilId={profilId}
      agents={(agents ?? []).map((agent) => ({
        id: agent.id,
        nom: agent.nom,
        couleur: agent.couleur,
      }))}
      blocageAgents={enveloppe ? raisonIndisponibilite(enveloppe) : null}
      rejeu={{
        actif: portefeuille?.rejeu_actif ?? false,
        symbole: portefeuille?.rejeu_symbole ?? null,
        intervalle: portefeuille?.rejeu_intervalle ?? null,
        curseur: portefeuille?.rejeu_curseur ?? null,
        debut: portefeuille?.rejeu_debut ?? null,
        fin: portefeuille?.rejeu_fin ?? null,
        source: portefeuille?.rejeu_source ?? null,
      }}
      capitalInitial={capitalInitial ?? 100_000}
    />
  );
}

function Ligne({
  libelle,
  valeur,
  classeValeur = '',
}: {
  libelle: string;
  valeur: string;
  classeValeur?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-texte-attenue">{libelle}</dt>
      <dd className={`chiffre text-sm ${classeValeur}`}>{valeur}</dd>
    </div>
  );
}
