import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { formaterNombre } from '@/lib/format';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Réglages — Trading Floor IA' };

export default async function PageReglages() {
  const supabase = await clientServeur();

  const [{ data: fournisseurs }, { data: risque }] = await Promise.all([
    supabase
      .from('fournisseurs_donnees')
      .select('id, code, nom, actif, quota_limite, quota_utilise, fenetre_quota, dernier_statut, derniere_erreur')
      .order('code'),
    supabase
      .from('parametres_risque')
      .select(
        'risque_max_par_trade_pct, risque_total_max_pct, positions_max, positions_correlees_max, perte_journaliere_max_pct, drawdown_max_pct, levier_max, fenetre_evenement_macro_minutes, stop_loss_obligatoire',
      )
      .maybeSingle(),
  ]);

  return (
    <>
      <EntetePage
        titre="Réglages"
        description="Fournisseurs de données, clés API, modèles LLM et limites de risque."
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <Panneau titre="Fournisseurs de données">
          {!fournisseurs || fournisseurs.length === 0 ? (
            <EtatVide message="Aucun fournisseur configuré." />
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-texte-attenue">
                <tr>
                  <th className="pb-2 font-medium">Fournisseur</th>
                  <th className="pb-2 font-medium">État</th>
                  <th className="pb-2 text-right font-medium">Quota</th>
                </tr>
              </thead>
              <tbody>
                {fournisseurs.map((fournisseur) => (
                  <tr key={fournisseur.id} className="border-t border-bordure/60">
                    <td className="py-1.5">
                      <span className="text-texte">{fournisseur.nom}</span>
                      <span className="chiffre ml-1.5 text-texte-attenue">{fournisseur.code}</span>
                    </td>
                    <td className="chiffre py-1.5 text-texte-attenue">
                      {fournisseur.actif ? 'actif' : 'inactif'}
                    </td>
                    <td className="chiffre py-1.5 text-right text-texte-attenue">
                      {fournisseur.quota_limite === null
                        ? 'illimité'
                        : `${fournisseur.quota_utilise} / ${fournisseur.quota_limite} · ${fournisseur.fenetre_quota.toLowerCase()}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-[11px] text-texte-attenue">
            Saisie des clés, test de connexion et ordre de priorité par classe d’actifs : phase 1.
            Les clés sont chiffrées en base et ne sont jamais renvoyées au navigateur.
          </p>
        </Panneau>

        <Panneau titre="Limites de risque">
          {!risque ? (
            <EtatVide message="Aucun paramètre de risque pour ce profil." />
          ) : (
            <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
              <Limite libelle="Risque par trade" valeur={`${formaterNombre(risque.risque_max_par_trade_pct, 2)} %`} />
              <Limite libelle="Risque total" valeur={`${formaterNombre(risque.risque_total_max_pct, 2)} %`} />
              <Limite libelle="Positions max" valeur={formaterNombre(risque.positions_max, 0)} />
              <Limite libelle="Corrélées max" valeur={formaterNombre(risque.positions_correlees_max, 0)} />
              <Limite libelle="Perte journalière" valeur={`${formaterNombre(risque.perte_journaliere_max_pct, 2)} %`} />
              <Limite libelle="Drawdown max" valeur={`${formaterNombre(risque.drawdown_max_pct, 2)} %`} />
              <Limite libelle="Levier max" valeur={`${formaterNombre(risque.levier_max, 0)}:1`} />
              <Limite
                libelle="Fenêtre macro"
                valeur={`${formaterNombre(risque.fenetre_evenement_macro_minutes, 0)} min`}
              />
              <Limite
                libelle="Stop-loss obligatoire"
                valeur={risque.stop_loss_obligatoire ? 'oui' : 'non'}
              />
            </dl>
          )}
          <p className="mt-3 text-[11px] text-texte-attenue">
            Ces plafonds sont appliqués par le moteur de risque en TypeScript côté serveur, pas par
            les prompts des agents. Édition en phase 3.
          </p>
        </Panneau>
      </div>
    </>
  );
}

function Limite({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded border border-bordure/60 px-2.5 py-1.5">
      <dt className="text-xs text-texte-attenue">{libelle}</dt>
      <dd className="chiffre text-sm">{valeur}</dd>
    </div>
  );
}
