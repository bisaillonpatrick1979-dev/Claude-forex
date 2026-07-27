import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';

export const metadata = { title: 'Backtest — Trading Floor IA' };

export default function PageBacktest() {
  return (
    <>
      <EntetePage
        titre="Backtest"
        description="Rejeu historique sur le même moteur d’exécution que le papier — une seule implémentation, deux sources d’horloge."
      />
      <Panneau className="min-h-56">
        <EtatVide
          message="Aucun backtest lancé."
          phase="Backtest et comparateurs — phase 6"
        />
        <p className="mx-auto mt-4 max-w-md text-center text-xs leading-relaxed text-texte-attenue">
          Chaque résultat sera affiché à côté de deux références : achat-conservation sur le même
          instrument, et une stratégie aléatoire de même fréquence. Si le système ne les bat pas,
          l’écran le dira.
        </p>
      </Panneau>
    </>
  );
}
