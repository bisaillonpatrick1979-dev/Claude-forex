import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { couleurPnl, formaterMonnaie } from '@/lib/format';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Historique des cycles — Trading Floor IA' };

export default async function PageHistorique() {
  const supabase = await clientServeur();
  const [{ data: cycles }, { data: lecons }] = await Promise.all([
    supabase
      .from('cycles')
      .select('id, etat, declencheur, demarre_le, intervalle, symboles(code)')
      .order('demarre_le', { ascending: false })
      .limit(50),
    supabase
      .from('lecons')
      .select('id, titre, contenu, etiquettes, resultat_pnl, cree_le, embedding, symboles(code)')
      .order('cree_le', { ascending: false })
      .limit(30),
  ]);

  return (
    <>
      <EntetePage
        titre="Historique des cycles"
        description="Chaque cycle de décision, rejouable message par message."
      />
      <Panneau titre="Cycles de décision">
        {!cycles || cycles.length === 0 ? (
          <EtatVide
            message="Aucun cycle exécuté."
            phase="Machine à états du cycle — phase 4"
          />
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {cycles.map((cycle) => (
              <li
                key={cycle.id}
                className="flex items-baseline justify-between gap-3 border-b border-bordure/60 py-1.5"
              >
                <span className="chiffre text-xs text-texte-attenue">
                  {new Date(cycle.demarre_le).toLocaleString('fr-CA')}
                </span>
                <span className="chiffre">
                  {cycle.symboles?.code ?? '—'} · {cycle.intervalle}
                </span>
                <span className="chiffre text-xs text-texte-attenue">{cycle.etat}</span>
              </li>
            ))}
          </ul>
        )}
      </Panneau>

      <Panneau titre="Mémoire de la firme">
        {!lecons || lecons.length === 0 ? (
          <EtatVide
            message="Aucune leçon écrite pour l’instant."
            phase="L’agent de réflexion débriefe chaque position fermée"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {lecons.map((lecon) => (
              <li key={lecon.id} className="rounded border border-bordure bg-panneau-clair p-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm">{lecon.titre}</h3>
                  <span
                    className={`chiffre shrink-0 text-xs ${couleurPnl(lecon.resultat_pnl)}`}
                  >
                    {lecon.resultat_pnl === null
                      ? '—'
                      : formaterMonnaie(Number(lecon.resultat_pnl))}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-texte-attenue">
                  {lecon.contenu}
                </p>
                <p className="chiffre mt-1.5 text-[10px] text-texte-attenue/60">
                  {lecon.symboles?.code ?? 'tous instruments'} ·{' '}
                  {new Date(lecon.cree_le).toLocaleString('fr-CA')}
                  {lecon.etiquettes.length > 0 ? ` · ${lecon.etiquettes.join(', ')}` : ''}
                  {/* Une leçon sans vecteur reste lisible ici mais ne sera jamais
                      resservie à un agent : autant le dire. */}
                  {lecon.embedding === null ? ' · non indexée' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panneau>
    </>
  );
}
