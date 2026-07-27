'use client';

import { useCallback, useMemo, useState } from 'react';

import { FilSpecialistes, type AgentAffiche } from '@/composants/agents/fil-specialistes';
import { ZoneGraphique, type SymboleOption } from '@/composants/graphique/zone-graphique';
import { construireMarqueurs, type SourcesMarqueurs } from '@/lib/orchestration/marqueurs';
import { Panneau } from '@/composants/ui/panneau';
import type { Intervalle } from '@/lib/marche/types';

import { BilletOrdre } from './billet-ordre';
import { CommandeRejeu, type EtatRejeu } from './commande-rejeu';
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
  sourcesMarqueurs,
  panneauFirme,
  panneauAgents,
  profilId,
  agents,
  blocageAgents,
  rejeu,
}: {
  symboles: readonly SymboleOption[];
  positions: readonly PositionAffichee[];
  ordres: readonly OrdreAffiche[];
  sourcesMarqueurs: SourcesMarqueurs;
  panneauFirme: React.ReactNode;
  panneauAgents: React.ReactNode;
  profilId: string;
  agents: readonly AgentAffiche[];
  blocageAgents: string | null;
  rejeu: EtatRejeu;
}) {
  const [symbole, setSymbole] = useState(symboles[0]?.code ?? 'EURUSD');
  const [intervalle, setIntervalle] = useState<Intervalle>('M5');
  const [dernierPrix, setDernierPrix] = useState<number | null>(null);

  const surDernierPrix = useCallback((prix: number | null) => setDernierPrix(prix), []);

  // Les marqueurs sont recalculés à chaque changement d'instrument ou
  // d'intervalle : l'alignement sur l'ouverture de bougie dépend des deux, et
  // un marqueur mal aligné n'est pas affiché du tout par lightweight-charts.
  const marqueurs = useMemo(
    () => construireMarqueurs(sourcesMarqueurs, symbole, intervalle),
    [sourcesMarqueurs, symbole, intervalle],
  );
  const decimales = symboles.find((option) => option.code === symbole)?.decimales ?? 5;

  return (
    // L'ordre visuel diffère selon la largeur. Sur grand écran, les trois
    // colonnes sont côte à côte et l'ordre du DOM convient. Empilé — tablette
    // comprise — on veut le graphique puis les agents en premier : ce sont eux
    // qu'on regarde, pas le billet d'ordre. `order` évite de dupliquer le
    // balisage pour obtenir deux dispositions.
    <div className="grid gap-3 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,24rem)]">
      <div className="order-3 flex flex-col gap-3 xl:order-1 xl:min-h-0">
        {panneauFirme}

        <Panneau titre="Rejeu historique et vitesse">
          <CommandeRejeu etat={rejeu} symbole={symbole} intervalle={intervalle} />
        </Panneau>

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

      <section className="order-1 flex h-[60vh] min-h-96 flex-col overflow-hidden rounded-lg border border-bordure bg-panneau xl:order-2 xl:h-auto xl:min-h-0">
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

      <div className="order-2 flex flex-col gap-3 xl:order-3 xl:min-h-0">
        {panneauAgents}

        <Panneau titre="Fil des spécialistes" className="flex-1 xl:min-h-0" defilement>
          <FilSpecialistes
            profilId={profilId}
            symbole={symbole}
            intervalle={intervalle}
            agents={agents}
            blocage={blocageAgents}
          />
        </Panneau>
      </div>
    </div>
  );
}
