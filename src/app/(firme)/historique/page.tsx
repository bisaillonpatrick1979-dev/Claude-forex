import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Historique des cycles — Trading Floor IA' };

export default async function PageHistorique() {
  const supabase = await clientServeur();
  const { data: cycles } = await supabase
    .from('cycles')
    .select('id, etat, declencheur, demarre_le, intervalle, symboles(code)')
    .order('demarre_le', { ascending: false })
    .limit(50);

  return (
    <>
      <EntetePage
        titre="Historique des cycles"
        description="Chaque cycle de décision, rejouable message par message."
      />
      <Panneau>
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
    </>
  );
}
