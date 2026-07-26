import { redirect } from 'next/navigation';

import { Atelier } from '@/composants/trading/atelier';
import type { OrdreAffiche, PositionAffichee } from '@/composants/trading/positions-ouvertes';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { couleurPnl, formaterMonnaie, formaterPourcentage, versNombre } from '@/lib/format';
import { listerSymboles } from '@/lib/marche/symboles';
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

  const [{ data: portefeuille }, symboles, { data: positions }, { data: ordres }] =
    await Promise.all([
      supabase
        .from('portefeuilles')
        .select('nom, devise, capital_initial, solde, equite, marge_utilisee, sommet_equite, gele, raison_gel')
        .eq('profil_id', profilId)
        .limit(1)
        .maybeSingle(),
      listerSymboles(supabase),
      supabase
        .from('positions')
        .select('id, sens, quantite, prix_entree, stop_loss, take_profit, symboles(code, decimales, taille_contrat)')
        .eq('profil_id', profilId)
        .eq('statut', 'OUVERTE')
        .order('ouvert_le', { ascending: false }),
      supabase
        .from('ordres')
        .select('id, sens, type_ordre, quantite, prix_demande, statut, symboles(code)')
        .eq('profil_id', profilId)
        .in('statut', ['EN_ATTENTE', 'PARTIELLEMENT_REMPLI'])
        .order('cree_le', { ascending: false }),
    ]);

  const equite = versNombre(portefeuille?.equite);
  const capitalInitial = versNombre(portefeuille?.capital_initial);
  const sommet = versNombre(portefeuille?.sommet_equite);
  const devise = portefeuille?.devise ?? 'USD';

  const pnlCumule = equite !== null && capitalInitial !== null ? equite - capitalInitial : null;
  const pnlCumulePct =
    pnlCumule !== null && capitalInitial ? (pnlCumule / capitalInitial) * 100 : null;
  const drawdownPct = equite !== null && sommet ? ((sommet - equite) / sommet) * 100 : null;

  const positionsAffichees: PositionAffichee[] = (positions ?? []).map((ligne) => ({
    id: ligne.id,
    symbole: ligne.symboles?.code ?? '—',
    sens: ligne.sens,
    quantite: Number(ligne.quantite),
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
          <Ligne libelle="Solde" valeur={formaterMonnaie(versNombre(portefeuille.solde), devise)} />
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
            <p className="rounded border border-baisse/40 bg-baisse/10 px-2 py-1 text-[11px] text-baisse">
              Portefeuille gelé — {portefeuille.raison_gel ?? 'kill switch'}
            </p>
          ) : null}
        </dl>
      ) : (
        <EtatVide message="Aucun portefeuille rattaché à ce profil." />
      )}
    </Panneau>
  );

  const filSpecialistes = (
    <Panneau titre="Fil des spécialistes" className="min-h-80 xl:min-h-0">
      <EtatVide
        message="Les agents débattront ici en direct, message par message."
        phase="Orchestration et Realtime — phases 4 et 5"
      />
    </Panneau>
  );

  return (
    <Atelier
      symboles={symboles}
      positions={positionsAffichees}
      ordres={ordresAffiches}
      panneauFirme={panneauFirme}
      filSpecialistes={filSpecialistes}
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
