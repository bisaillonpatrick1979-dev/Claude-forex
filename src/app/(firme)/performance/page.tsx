import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import {
  TRADES_MINIMUM_POUR_CONCLURE,
  resultatsParSeance,
  seancesRemarquables,
  type ResultatSeance,
} from '@/lib/backtest/par-seance';
import { formaterMonnaie } from '@/lib/format';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Journal de performance — Trading Floor IA' };

/**
 * Journal de performance, découpé par séance de marché.
 *
 * C'est la lecture que met en avant tout journal de trading professionnel, et
 * pour une raison mesurable : le même système ne rend pas la même chose à 3 h
 * et à 14 h. Un rendement global masque exactement cela.
 *
 * La séance n'est stockée nulle part — elle se déduit de l'heure d'ouverture.
 * Les positions déjà en base se découpent donc rétroactivement, sans migration
 * et sans risque de divergence entre la colonne et l'horodatage.
 */
export default async function PagePerformance() {
  const supabase = await clientServeur();

  const { data: fermees } = await supabase
    .from('positions')
    .select('id, ouvert_le, ferme_le, pnl_realise, sens, quantite, symboles(code)')
    .eq('statut', 'FERMEE')
    .order('ferme_le', { ascending: false })
    .limit(500);

  const trades = (fermees ?? []).map((ligne) => ({
    ouvertLe: Math.floor(new Date(ligne.ouvert_le).getTime() / 1000),
    pnl: ligne.pnl_realise === null ? null : Number(ligne.pnl_realise),
  }));

  const parSeance = resultatsParSeance(trades);
  const { meilleure, pire } = seancesRemarquables(parSeance);

  return (
    <>
      <EntetePage
        titre="Journal de performance"
        description="Résultats mesurés du portefeuille papier, découpés par séance de marché. Aucun chiffre n’est projeté : ce sont des résultats constatés."
      />

      <Panneau titre="Résultats par séance" className="mb-3">
        {trades.length === 0 ? (
          <EtatVide message="Aucune position fermée : rien à découper par séance." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-bordure text-left text-xs uppercase tracking-wide text-texte-attenue">
                    <th className="py-1.5 pr-3 font-medium">Séance</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Trades</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Résultat</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Réussite</th>
                    <th className="py-1.5 text-right font-medium">Part</th>
                  </tr>
                </thead>
                <tbody>
                  {parSeance.map((ligne) => (
                    <Ligne key={ligne.code} ligne={ligne} total={trades.length} />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-texte-attenue">
              {meilleure && pire ? (
                <>
                  Sur cet échantillon, <span className="text-texte">{meilleure.nom}</span> rapporte
                  le plus et <span className="text-texte">{pire.nom}</span> coûte le plus. C’est un
                  constat sur {meilleure.trades + pire.trades} trades, pas une prédiction : une
                  séance peut simplement avoir été chanceuse.
                </>
              ) : (
                <>
                  Aucune séance n’est désignée : il faut au moins{' '}
                  {TRADES_MINIMUM_POUR_CONCLURE} trades sur deux séances différentes pour que la
                  comparaison veuille dire quelque chose. En dessous, on lirait du bruit.
                </>
              )}
            </p>
          </>
        )}
      </Panneau>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panneau titre="Courbe d’équité" className="min-h-56">
          <EtatVide message="Instantanés quotidiens en cours d’accumulation." />
        </Panneau>
        <Panneau titre="Trades réalisés" className="min-h-56">
          {trades.length === 0 ? (
            <EtatVide message="Aucune position fermée." />
          ) : (
            <p className="chiffre text-sm text-texte-attenue">
              {trades.length} position(s) fermée(s) — détail par séance ci-dessus.
            </p>
          )}
        </Panneau>
      </div>
    </>
  );
}

function Ligne({ ligne, total }: { ligne: ResultatSeance; total: number }) {
  const vide = ligne.trades === 0;
  const couleur = ligne.pnl > 0 ? 'text-hausse' : ligne.pnl < 0 ? 'text-baisse' : 'text-texte';

  return (
    <tr className={`border-b border-bordure/40 ${vide ? 'text-texte-attenue/60' : ''}`}>
      <td className="py-1.5 pr-3">{ligne.nom}</td>
      <td className="chiffre py-1.5 pr-3 text-right">{ligne.trades}</td>
      <td className={`chiffre py-1.5 pr-3 text-right ${vide ? '' : couleur}`}>
        {vide ? '—' : formaterMonnaie(ligne.pnl)}
      </td>
      <td className="chiffre py-1.5 pr-3 text-right">
        {/* « Donnée manquante » plutôt que 0 % : un taux inconnu et un taux nul
            ne disent pas la même chose. */}
        {ligne.tauxReussitePct === null ? '—' : `${ligne.tauxReussitePct.toFixed(0)} %`}
        {ligne.sansResultat > 0 ? (
          <span className="ml-1 text-texte-attenue" title={`${ligne.sansResultat} trade(s) sans P&L enregistré`}>
            ({ligne.sansResultat} sans résultat)
          </span>
        ) : null}
      </td>
      <td className="chiffre py-1.5 text-right">
        {vide ? '—' : `${((ligne.trades / total) * 100).toFixed(0)} %`}
      </td>
    </tr>
  );
}
