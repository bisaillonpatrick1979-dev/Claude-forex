/**
 * Écran de diagnostic affiché quand la configuration Supabase manque.
 *
 * Sans lui, un déploiement dont les variables d'environnement ne sont pas
 * renseignées renvoie une erreur 500 sur toutes les pages, sans dire laquelle
 * manque. Ce n'est pas un écran de secours cosmétique : c'est le premier chose
 * qu'on voit sur un déploiement neuf, et il doit donner la marche à suivre.
 */
export function ConfigurationManquante({ variables }: { variables: readonly string[] }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-bordure bg-panneau p-5">
        <p className="chiffre text-[11px] uppercase tracking-[0.2em] text-texte-attenue">
          Trading Floor IA
        </p>
        <h1 className="mt-2 text-lg font-semibold text-alerte">Configuration incomplète</h1>
        <p className="mt-2 text-sm text-texte-attenue">
          L’application est déployée mais ne peut pas joindre Supabase. Variables absentes :
        </p>

        <ul className="chiffre mt-3 flex flex-col gap-1 text-xs">
          {variables.map((variable) => (
            <li key={variable} className="rounded border border-bordure bg-fond px-2.5 py-1.5">
              {variable}
            </li>
          ))}
        </ul>

        <div className="mt-4 text-xs leading-relaxed text-texte-attenue">
          <p>
            Sur Vercel : Project → Settings → Environment Variables, puis redéployer. Les variables
            préfixées <span className="chiffre">NEXT_PUBLIC_</span> sont intégrées au moment du
            build : un simple redémarrage ne suffit pas, il faut relancer le déploiement.
          </p>
          <p className="mt-2">
            En local : copier <span className="chiffre">.env.example</span> vers{' '}
            <span className="chiffre">.env.local</span> et remplir les valeurs.
          </p>
        </div>
      </div>
    </main>
  );
}
