import { ConfigurationManquante } from '@/composants/configuration-manquante';
import { variablesPubliquesManquantes } from '@/lib/config/env';
import { AVERTISSEMENT_RISQUE } from '@/lib/config/modes';

import { FormulaireConnexion } from './formulaire';

export const metadata = { title: 'Connexion — Trading Floor IA' };

export default async function PageConnexion({
  searchParams,
}: {
  searchParams: Promise<{ suivant?: string }>;
}) {
  const manquantes = variablesPubliquesManquantes();
  if (manquantes.length > 0) {
    return <ConfigurationManquante variables={manquantes} />;
  }

  const params = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="chiffre text-xs uppercase tracking-[0.2em] text-texte-attenue">
            Trading Floor
          </p>
          <h1 className="mt-1 text-2xl font-semibold">IA</h1>
          <p className="mt-3 text-sm text-texte-attenue">
            Une firme de trading simulée : des agents spécialisés analysent, débattent et décident
            sur un portefeuille papier.
          </p>
        </div>

        <div className="rounded-lg border border-bordure bg-panneau p-5">
          <FormulaireConnexion suivant={params.suivant ?? '/salle-des-marches'} />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-texte-attenue">{AVERTISSEMENT_RISQUE}</p>
      </div>
    </main>
  );
}
