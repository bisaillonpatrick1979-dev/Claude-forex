import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { formaterMonnaie, versNombre } from '@/lib/format';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Coûts — Trading Floor IA' };

export default async function PageCouts() {
  const supabase = await clientServeur();

  const [{ data: profil }, { data: appels }] = await Promise.all([
    supabase.from('profils').select('plafond_cout_quotidien_usd').maybeSingle(),
    supabase.from('appels_llm').select('cout_usd, cree_le').order('cree_le', { ascending: false }).limit(100),
  ]);

  const plafond = versNombre(profil?.plafond_cout_quotidien_usd);

  return (
    <>
      <EntetePage
        titre="Coûts"
        description="Dépense LLM par jour et par agent. Le plafond quotidien met les agents en pause quand il est atteint."
      />
      <div className="grid gap-3 xl:grid-cols-2">
        <Panneau titre="Plafond quotidien">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-texte-attenue">Plafond configuré</span>
            <span className="chiffre text-sm">{formaterMonnaie(plafond)}</span>
          </div>
          <p className="mt-3 text-[11px] text-texte-attenue">
            Édition du plafond et détail par agent : phase 6. L’adaptateur LLM « mock » permet de
            faire tourner un cycle complet sans dépenser un sou.
          </p>
        </Panneau>

        <Panneau titre="Appels récents" className="min-h-40">
          {!appels || appels.length === 0 ? (
            <EtatVide message="Aucun appel LLM enregistré." phase="Adaptateurs LLM — phase 4" />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {appels.map((appel, index) => (
                <li key={index} className="flex justify-between border-b border-bordure/60 py-1">
                  <span className="chiffre text-xs text-texte-attenue">
                    {new Date(appel.cree_le).toLocaleString('fr-CA')}
                  </span>
                  <span className="chiffre text-xs">{formaterMonnaie(versNombre(appel.cout_usd))}</span>
                </li>
              ))}
            </ul>
          )}
        </Panneau>
      </div>
    </>
  );
}
