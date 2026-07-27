import { redirect } from 'next/navigation';

import { archiverPropositionsExpirees } from '@/app/actions/propositions';
import { EntetePage } from '@/composants/ui/entete-page';
import { Panneau } from '@/composants/ui/panneau';
import { clientServeur } from '@/lib/supabase/serveur';

import { FileValidation, type PropositionAffichee } from './file-validation';

export const metadata = { title: 'Validation — Trading Floor IA' };

/** Rien n'est mis en cache : une file d'attente périmée n'a aucune valeur. */
export const dynamic = 'force-dynamic';

export default async function PageValidation() {
  const supabase = await clientServeur();
  const { data: jetons } = await supabase.auth.getClaims();
  const profilId = jetons?.claims?.sub;
  if (typeof profilId !== 'string') redirect('/connexion');

  // Les propositions périmées sont archivées avant l'affichage : sans cela, un
  // bouton « Approuver » resterait cliquable sur un ordre calculé sur des prix
  // qui n'existent plus.
  await archiverPropositionsExpirees();

  const [{ data: propositions }, { data: recentes }] = await Promise.all([
    supabase
      .from('propositions_ordres')
      .select(
        `id, sens, type_ordre, quantite, prix_entree, stop_loss, take_profit, raisonnement,
         cree_le, valide_jusqu_a, intervalle,
         symboles (code), agents (nom),
         decisions_risque (decision, raison, risque_estime_pct, cree_le)`,
      )
      .eq('profil_id', profilId)
      .eq('statut', 'EN_ATTENTE_VALIDATION')
      .order('cree_le', { ascending: false }),
    supabase
      .from('propositions_ordres')
      .select('id, statut, sens, quantite, decide_le, symboles (code), agents (nom)')
      .eq('profil_id', profilId)
      .in('statut', [
        'ACCEPTEE',
        'REFUSEE_UTILISATEUR',
        'REFUSEE_PERMISSION',
        'REJETEE_RISQUE',
        'EXPIREE',
      ])
      .order('decide_le', { ascending: false })
      .limit(10),
  ]);

  const affichees: PropositionAffichee[] = (propositions ?? []).map((ligne) => {
    const risques = ligne.decisions_risque ?? [];
    const dernierRisque = risques[risques.length - 1];

    return {
      id: ligne.id,
      agent: ligne.agents?.nom ?? 'agent inconnu',
      symbole: ligne.symboles?.code ?? '—',
      intervalle: ligne.intervalle,
      sens: ligne.sens,
      type: ligne.type_ordre,
      quantite: Number(ligne.quantite),
      prixEntree: ligne.prix_entree === null ? null : Number(ligne.prix_entree),
      stopLoss: ligne.stop_loss === null ? null : Number(ligne.stop_loss),
      takeProfit: ligne.take_profit === null ? null : Number(ligne.take_profit),
      raisonnement: ligne.raisonnement,
      creeLe: ligne.cree_le,
      valideJusquA: ligne.valide_jusqu_a,
      risque: dernierRisque
        ? {
            decision: dernierRisque.decision,
            raison: dernierRisque.raison,
            risqueEstimePct:
              dernierRisque.risque_estime_pct === null
                ? null
                : Number(dernierRisque.risque_estime_pct),
          }
        : null,
    };
  });

  return (
    <>
      <EntetePage
        titre="Validation"
        description="Les ordres que les agents veulent passer et qui attendent votre décision."
      />

      <div className="flex flex-col gap-3">
        <FileValidation propositions={affichees} />

        {recentes && recentes.length > 0 ? (
          <Panneau titre="Décidées récemment">
            <ul className="flex flex-col gap-1">
              {recentes.map((ligne) => (
                <li key={ligne.id} className="chiffre flex flex-wrap items-baseline gap-2 text-[11px]">
                  <span
                    className={
                      ligne.statut === 'ACCEPTEE'
                        ? 'text-hausse'
                        : ligne.statut === 'EXPIREE'
                          ? 'text-texte-attenue'
                          : 'text-baisse'
                    }
                  >
                    {ligne.statut.toLowerCase().replace(/_/g, ' ')}
                  </span>
                  <span>
                    {ligne.sens} {Number(ligne.quantite)} {ligne.symboles?.code ?? '—'}
                  </span>
                  <span className="text-texte-attenue">{ligne.agents?.nom ?? '—'}</span>
                  <span className="text-texte-attenue">
                    {ligne.decide_le
                      ? new Date(ligne.decide_le).toLocaleString('fr-CA', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </Panneau>
        ) : null}
      </div>
    </>
  );
}
