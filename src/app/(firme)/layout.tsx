import { redirect } from 'next/navigation';

import { ConfigurationManquante } from '@/composants/configuration-manquante';
import { BarreSuperieure } from '@/composants/enveloppe/barre-superieure';
import { NavigationLaterale } from '@/composants/enveloppe/navigation-laterale';
import type { ModeOperation } from '@/lib/config/drapeaux';
import { variablesPubliquesManquantes } from '@/lib/config/env';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Enveloppe des pages authentifiées. Le middleware a déjà écarté les visiteurs
 * sans session ; on revérifie ici parce qu'une page ne doit jamais dépendre
 * uniquement du middleware pour sa sécurité.
 */
export default async function LayoutFirme({ children }: { children: React.ReactNode }) {
  const manquantes = variablesPubliquesManquantes();
  if (manquantes.length > 0) {
    return <ConfigurationManquante variables={manquantes} />;
  }

  const supabase = await clientServeur();
  const { data: jetons } = await supabase.auth.getClaims();
  const profilId = jetons?.claims?.sub;

  if (typeof profilId !== 'string') {
    redirect('/connexion');
  }

  const [resultatProfil, resultatPortefeuille] = await Promise.all([
    supabase.from('profils').select('courriel, mode_operation').eq('id', profilId).maybeSingle(),
    supabase.from('portefeuilles').select('gele').eq('profil_id', profilId).limit(1).maybeSingle(),
  ]);

  const profil = resultatProfil.data;
  const mode: ModeOperation = profil?.mode_operation ?? 'PAPIER_AUTONOME';

  return (
    // La hauteur n'est verrouillée à l'écran qu'à partir de `xl`. En dessous —
    // tablette en paysage comprise — c'est la page entière qui défile, plutôt
    // que chaque panneau dans son coin.
    <div className="flex min-h-dvh flex-col xl:h-dvh">
      <BarreSuperieure
        courriel={profil?.courriel ?? ''}
        mode={mode}
        gele={resultatPortefeuille.data?.gele ?? false}
      />
      <div className="flex flex-1 flex-col lg:flex-row xl:min-h-0">
        <NavigationLaterale />
        <main className="flex-1 p-3 xl:min-h-0 xl:overflow-auto">{children}</main>
      </div>
    </div>
  );
}
