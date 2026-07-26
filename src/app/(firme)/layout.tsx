import { redirect } from 'next/navigation';

import { BarreSuperieure } from '@/composants/enveloppe/barre-superieure';
import { NavigationLaterale } from '@/composants/enveloppe/navigation-laterale';
import type { ModeOperation } from '@/lib/config/drapeaux';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Enveloppe des pages authentifiées. Le middleware a déjà écarté les visiteurs
 * sans session ; on revérifie ici parce qu'une page ne doit jamais dépendre
 * uniquement du middleware pour sa sécurité.
 */
export default async function LayoutFirme({ children }: { children: React.ReactNode }) {
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
    <div className="flex h-dvh flex-col">
      <BarreSuperieure
        courriel={profil?.courriel ?? ''}
        mode={mode}
        gele={resultatPortefeuille.data?.gele ?? false}
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <NavigationLaterale />
        <main className="min-h-0 flex-1 overflow-auto p-3">{children}</main>
      </div>
    </div>
  );
}
