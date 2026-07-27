import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { formaterMonnaie, versNombre } from '@/lib/format';
import { etatBudget } from '@/lib/ia/budget';
import { FUSEAU_DEFAUT, fuseauValide } from '@/lib/temps/journee';
import { clientServeur } from '@/lib/supabase/serveur';

export const metadata = { title: 'Coûts — Trading Floor IA' };

/**
 * Dépense en appels de modèles.
 *
 * Deux corrections par rapport à l'écran précédent, qui n'affichait que le
 * plafond configuré :
 *
 *  - la dépense **du jour** est montrée à côté, sinon le plafond ne dit rien de
 *    ce qui reste ;
 *  - les horodatages sont rendus dans le fuseau du profil et non dans celui du
 *    serveur. Un serveur Vercel tourne en UTC : « 02 h 14 » pour un appel passé
 *    à 20 h 14 en Alberta rendait le journal illisible, et le compteur du jour
 *    incompréhensible.
 */
export default async function PageCouts() {
  const supabase = await clientServeur();

  const { data: session } = await supabase.auth.getClaims();
  const profilId = session?.claims?.sub;

  const budget =
    typeof profilId === 'string'
      ? await etatBudget(supabase, profilId)
      : null;

  const { data: appels } = await supabase
    .from('appels_llm')
    .select('cout_usd, cree_le, modele, succes')
    .order('cree_le', { ascending: false })
    .limit(100);

  const fuseau = fuseauValide(budget?.fuseau ?? FUSEAU_DEFAUT);
  const partConsommee =
    budget && budget.plafondUsd > 0
      ? Math.min(100, (budget.depenseUsd / budget.plafondUsd) * 100)
      : 0;

  return (
    <>
      <EntetePage
        titre="Coûts"
        description="Dépense LLM par jour. Le plafond quotidien met les agents en pause quand il est atteint."
      />
      <div className="grid gap-3 xl:grid-cols-2">
        <Panneau titre="Plafond quotidien">
          {!budget ? (
            <EtatVide message="Session expirée." />
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-texte-attenue">Dépensé aujourd’hui</span>
                <span className={`chiffre text-sm ${budget.depasse ? 'text-alerte' : 'text-texte'}`}>
                  {formaterMonnaie(budget.depenseUsd)} / {formaterMonnaie(budget.plafondUsd)}
                </span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded bg-bordure/60">
                <div
                  className={`h-full ${budget.depasse ? 'bg-alerte' : 'bg-accent'}`}
                  style={{ width: `${partConsommee}%` }}
                />
              </div>

              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="text-xs text-texte-attenue">Reste</span>
                <span className="chiffre text-sm">{formaterMonnaie(budget.restantUsd)}</span>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-texte-attenue">
                Journée locale : le compteur s’est réarmé le{' '}
                <span className="chiffre">{horodatage(budget.debutJournee, fuseau)}</span>, fuseau{' '}
                {budget.libelleFuseau}. Le plafond se modifie dans Réglages et s’applique au
                prochain appel.
                {budget.depasse ? (
                  <span className="text-alerte">
                    {' '}
                    Plafond atteint : les cycles s’arrêtent jusqu’au prochain minuit local.
                  </span>
                ) : null}
              </p>
            </>
          )}
        </Panneau>

        <Panneau titre="Appels récents" className="min-h-40">
          {!appels || appels.length === 0 ? (
            <EtatVide message="Aucun appel LLM enregistré." />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {appels.map((appel, index) => (
                <li
                  key={index}
                  className="flex items-baseline justify-between gap-2 border-b border-bordure/60 py-1"
                >
                  <span className="chiffre text-xs text-texte-attenue">
                    {horodatage(appel.cree_le, fuseau)}
                  </span>
                  <span className="truncate text-xs text-texte-attenue">{appel.modele}</span>
                  <span
                    className={`chiffre text-xs ${appel.succes ? 'text-texte' : 'text-alerte'}`}
                  >
                    {appel.succes ? formaterMonnaie(versNombre(appel.cout_usd)) : 'échec'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panneau>
      </div>
    </>
  );
}

/** Rendu dans le fuseau du profil, jamais dans celui du serveur. */
function horodatage(iso: string, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: fuseau,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
