import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';

export const metadata = { title: 'Journal de performance — Trading Floor IA' };

export default function PagePerformance() {
  return (
    <>
      <EntetePage
        titre="Journal de performance"
        description="Résultats mesurés du portefeuille papier : trades réalisés, courbe d’équité, métriques."
      />
      <div className="grid gap-3 xl:grid-cols-2">
        <Panneau titre="Courbe d’équité" className="min-h-56">
          <EtatVide
            message="Aucun instantané de portefeuille."
            phase="Moteur d’exécution — phase 3"
          />
        </Panneau>
        <Panneau titre="Trades réalisés" className="min-h-56">
          <EtatVide message="Aucune position fermée." phase="Moteur d’exécution — phase 3" />
        </Panneau>
      </div>
    </>
  );
}
