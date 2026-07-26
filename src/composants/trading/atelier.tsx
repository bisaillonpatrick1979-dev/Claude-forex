'use client';

import { useCallback, useState } from 'react';

import { ZoneGraphique, type SymboleOption } from '@/composants/graphique/zone-graphique';
import type { MarqueurDecision } from '@/composants/graphique/types-graphique';
import { Panneau } from '@/composants/ui/panneau';
import type { Intervalle } from '@/lib/marche/types';

import { BilletOrdre } from './billet-ordre';
import {
  OrdresEnAttente,
  PositionsOuvertes,
  type OrdreAffiche,
  type PositionAffichee,
} from './positions-ouvertes';

/**
 * Atelier de trading : le graphique, le billet d'ordre, les positions et les
 * ordres partagent le même couple symbole/intervalle et le même dernier prix.
 *
 * Sans cette mise en commun, on pourrait regarder EUR/USD et passer un ordre
 * sur le Nasdaq sans que rien ne le signale.
 */
export function Atelier({
  symboles,
  positions,
  ordres,
  marqueurs = [],
  panneauFirme,
  filSpecialistes,
}: {
  symboles: readonly SymboleOption[];
  positions: readonly PositionAffichee[];
  ordres: readonly OrdreAffiche[];
  marqueurs?: readonly MarqueurDecision[];
  panneauFirme: React.ReactNode;
  filSpecialistes: React.ReactNode;
}) {
  const [symbole, setSymbole] = useState(symboles[0]?.code ?? 'EURUSD');
  const [intervalle, setIntervalle] = useState<Intervalle>('M5');
  const [dernierPrix, setDernierPrix] = useState<number | null>(null);

  const surDernierPrix = useCallback((prix: number | null) => setDernierPrix(prix), []);
  const decimales = symboles.find((option) => option.code === symbole)?.decimales ?? 5;

  return (
    <div className="grid min-h-0 gap-3 xl:h-full xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex min-h-0 flex-col gap-3">
        {panneauFirme}

        <Panneau titre="Passer un ordre">
          <BilletOrdre
            symbole={symbole}
            intervalle={intervalle}
            dernierPrix={dernierPrix}
            decimales={decimales}
          />
        </Panneau>

        <Panneau titre="Positions ouvertes">
          <PositionsOuvertes
            positions={positions}
            dernierPrix={dernierPrix}
            symboleCourant={symbole}
            intervalle={intervalle}
          />
        </Panneau>

        <Panneau titre="Ordres en attente">
          <OrdresEnAttente ordres={ordres} symboleCourant={symbole} intervalle={intervalle} />
        </Panneau>
      </div>

      <section className="flex min-h-96 flex-col overflow-hidden rounded-lg border border-bordure bg-panneau xl:min-h-0">
        <ZoneGraphique
          symboles={symboles}
          marqueurs={marqueurs}
          symboleControle={symbole}
          intervalleControle={intervalle}
          surSymbole={setSymbole}
          surIntervalle={setIntervalle}
          surDernierPrix={surDernierPrix}
        />
      </section>

      {filSpecialistes}
    </div>
  );
}
