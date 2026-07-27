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
    // Le graphique domine, tout le reste passe dessous.
    //
    // La disposition précédente le coinçait dans une colonne centrale entre
    // deux colonnes de panneaux : sur un portable, il lui restait moins de la
    // moitié de la largeur, et les bougies devenaient des traits. Or c'est
    // l'objet qu'on regarde le plus longtemps — il mérite la place, et les
    // panneaux qu'on consulte par intermittence peuvent attendre plus bas.
    //
    // Le fil des spécialistes reste à côté : c'est le seul panneau qu'on suit
    // *pendant* qu'on regarde le prix, et il a besoin de hauteur, pas de
    // largeur. Tous les autres descendent.
    <div className="flex flex-col gap-3">
      {/* `items-start` : chaque panneau garde la hauteur qu'il s'est donnée.
          Sans lui, une grille étire ses éléments sur le plus haut, et un
          contenu qui dépasse sa boîte se retrouve à recouvrir le voisin. */}
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        {/* Trois quarts de la largeur, et une hauteur qui suit l'écran plutôt
            qu'un plafond fixe : sur un grand moniteur le graphique respire,
            sur un portable il garde un plancher lisible. */}
        <section className="flex h-[68vh] min-h-[26rem] flex-col overflow-hidden rounded-lg border border-bordure bg-panneau">
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

        {/* À côté du graphique : le fil des agents, et rien d'autre.
            La version précédente empilait ici l'enveloppe *et* le fil sous une
            hauteur imposée. Dès que la somme des deux dépassait cette hauteur,
            le contenu débordait par-dessus la rangée du dessous — d'où les
            panneaux qui se chevauchaient, et le fil réduit à rien.
            Un seul enfant, une hauteur définie : plus d'arithmétique à faire
            tenir, donc plus rien qui déborde. L'enveloppe « Vos agents »
            descend avec les autres boîtes, où sa place est naturelle : c'est un
            bloc de chiffres qu'on consulte, pas quelque chose qu'on suit en
            continu. */}
        <Panneau
          titre="Fil des spécialistes"
          corpsDefilant
          className="h-[24rem] xl:h-[68vh]"
        >
          <FilSpecialistes
            profilId={profilId}
            symbole={symbole}
            intervalle={intervalle}
            agents={agents}
            blocage={blocageAgents}
          />
        </Panneau>
      </div>

      {/* Tout ce qu'on consulte par intermittence, sous le graphique. Deux
          colonnes sur tablette, quatre sur grand écran : les panneaux sont
          courts, les empiler sur une seule colonne obligerait à défiler pour
          rien. */}
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        {panneauAgents}

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

        <Panneau titre="Placements de la firme">
          <Placements placements={placements} />
        </Panneau>

        {panneauFirme}

        <Panneau titre="Rejeu historique et vitesse">
          <CommandeRejeu
            etat={rejeu}
            symbole={symbole}
            intervalle={intervalle}
            capitalInitial={capitalInitial}
          />
        </Panneau>
      </div>
    </div>
  );
}
