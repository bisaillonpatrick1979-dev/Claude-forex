'use client';

import { useCallback, useMemo, useState } from 'react';

import { FilSpecialistes, type AgentAffiche } from '@/composants/agents/fil-specialistes';
import { ZoneGraphique, type SymboleOption } from '@/composants/graphique/zone-graphique';
import { construireMarqueurs, type SourcesMarqueurs } from '@/lib/orchestration/marqueurs';
import { Panneau } from '@/composants/ui/panneau';
import type { Intervalle } from '@/lib/marche/types';

import { BilletOrdre } from './billet-ordre';
import { CommandeRejeu, type EtatRejeu } from './commande-rejeu';
import { Placements, type PlacementAffiche } from './placements';
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
  placements,
  panneauFirme,
  panneauAgents,
  profilId,
  agents,
  blocageAgents,
  rejeu,
  capitalInitial,
}: {
  symboles: readonly SymboleOption[];
  positions: readonly PositionAffichee[];
  ordres: readonly OrdreAffiche[];
  sourcesMarqueurs: SourcesMarqueurs;
  placements: readonly PlacementAffiche[];
  panneauFirme: React.ReactNode;
  panneauAgents: React.ReactNode;
  profilId: string;
  agents: readonly AgentAffiche[];
  blocageAgents: string | null;
  rejeu: EtatRejeu;
  capitalInitial: number;
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
    // `items-start` est la correction principale : par défaut, une grille étire
    // chaque colonne à la hauteur de la plus haute. Le fil des spécialistes
    // grandit à chaque message, et le graphique grandissait avec lui —
    // jusqu'à occuper tout l'écran. Il garde désormais sa hauteur propre, sauf
    // en cockpit où l'étirement est justement ce qu'on veut.
    <div className="cockpit-plein cockpit-flexible cockpit-etirer grid items-start gap-3 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,24rem)]">
      <div className="cockpit-flexible order-3 flex flex-col gap-3 xl:order-1">
        {panneauFirme}

        <Panneau titre="Rejeu historique et vitesse">
          <CommandeRejeu
            etat={rejeu}
            symbole={symbole}
            intervalle={intervalle}
            capitalInitial={capitalInitial}
          />
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
          <OrdresEnAttente ordres={ordres} intervalle={intervalle} />
        </Panneau>
      </div>

      {/* Colonne centrale : le graphique, et juste dessous ce que la firme a
          réellement placé. C'est la lecture naturelle — on regarde le prix,
          puis on regarde ce qu'on en a fait. */}
      <div className="cockpit-flexible order-1 flex flex-col gap-3 xl:order-2">
        <section className="cockpit-part-3 flex h-[46vh] min-h-[22rem] max-h-[36rem] flex-col overflow-hidden rounded-lg border border-bordure bg-panneau">
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

        <Panneau titre="Placements de la firme" className="cockpit-part-2">
          <Placements placements={placements} />
        </Panneau>
      </div>

      <div className="cockpit-flexible order-2 flex flex-col gap-3 xl:order-3">
        {panneauAgents}

        <Panneau titre="Fil des spécialistes" className="min-h-[28rem] flex-1">
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
