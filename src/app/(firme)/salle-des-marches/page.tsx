import { redirect } from 'next/navigation';

import { ZoneGraphique } from '@/composants/graphique/zone-graphique';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { couleurPnl, formaterMonnaie, formaterPourcentage, versNombre } from '@/lib/format';
import { listerSymboles } from '@/lib/marche/symboles';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Salle des marchés — Trading Floor IA' };

/**
 * Écran principal, en trois zones sur grand écran et empilé sur tablette et
 * mobile. En phase 0 les zones sont structurellement en place mais vides :
 * le graphique arrive en phase 2, le fil des spécialistes en phase 5.
 *
 * Les chiffres de la zone gauche sont déjà réels — ils viennent du
 * portefeuille en base, pas d'un jeu de données de démonstration.
 */
export default async function PageSalleDesMarches() {
  const supabase = await clientServeur();
  const { data: jetons } = await supabase.auth.getClaims();
  const profilId = jetons?.claims?.sub;
  if (typeof profilId !== 'string') redirect('/connexion');

  const [{ data: portefeuille }, symboles] = await Promise.all([
    supabase
      .from('portefeuilles')
      .select('nom, devise, capital_initial, solde, equite, marge_utilisee, sommet_equite, gele, raison_gel')
      .eq('profil_id', profilId)
      .limit(1)
      .maybeSingle(),
    listerSymboles(supabase),
  ]);

  const equite = versNombre(portefeuille?.equite);
  const capitalInitial = versNombre(portefeuille?.capital_initial);
  const sommet = versNombre(portefeuille?.sommet_equite);
  const devise = portefeuille?.devise ?? 'USD';

  const pnlCumule = equite !== null && capitalInitial !== null ? equite - capitalInitial : null;
  const pnlCumulePct =
    pnlCumule !== null && capitalInitial ? (pnlCumule / capitalInitial) * 100 : null;
  const drawdownPct = equite !== null && sommet ? ((sommet - equite) / sommet) * 100 : null;

  return (
    <div className="grid min-h-0 gap-3 xl:h-full xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,22rem)]">
      {/* Zone gauche — la firme */}
      <div className="flex min-h-0 flex-col gap-3">
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
            </dl>
          ) : (
            <EtatVide message="Aucun portefeuille rattaché à ce profil." />
          )}
        </Panneau>

        <Panneau titre="Positions ouvertes" className="min-h-32">
          <EtatVide message="Aucune position." phase="Moteur d’exécution — phase 3" />
        </Panneau>

        <Panneau titre="Ordres en attente" className="min-h-32">
          <EtatVide
            message="Aucun ordre à valider."
            phase="Mode validation — phase 5"
          />
        </Panneau>
      </div>

      {/* Zone centrale — le graphique */}
      <section className="flex min-h-96 flex-col overflow-hidden rounded-lg border border-bordure bg-panneau xl:min-h-0">
        <ZoneGraphique symboles={symboles} />
      </section>

      {/* Zone droite — le fil des spécialistes */}
      <Panneau titre="Fil des spécialistes" className="min-h-80 xl:min-h-0">
        <EtatVide
          message="Les agents débattront ici en direct, message par message."
          phase="Orchestration et Realtime — phases 4 et 5"
        />
      </Panneau>
    </div>
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
