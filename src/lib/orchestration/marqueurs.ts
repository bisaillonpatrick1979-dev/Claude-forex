import { debutBougie } from '@/lib/marche/intervalles';
import type { Intervalle } from '@/lib/marche/types';

/**
 * Marqueurs de décision : ce que la firme a fait, posé sur le graphique.
 *
 * Fonction pure et testée. Elle traduit des lignes de base en marqueurs, sans
 * rien lire ni écrire — le même code sert au temps réel, au rejeu et, plus
 * tard, à la relecture d'un cycle archivé.
 *
 * Trois choses sont marquées, et la troisième compte autant que les deux
 * autres :
 *
 *   - les entrées : où la firme s'est engagée ;
 *   - les sorties : à quel prix et pour quel résultat ;
 *   - les refus : où elle a décidé de **ne pas** agir, et pourquoi.
 *
 * Sans les refus, on ne verrait que les décisions qui ont coûté ou rapporté,
 * jamais celles qui ont évité une perte. Un garde-fou qui fait son travail est
 * invisible ; c'est précisément ce qu'il faut rendre visible.
 */

export type OrigineMarqueur = 'MANUEL' | 'AGENT';

export interface EntreePosition {
  readonly id: string;
  readonly symbole: string;
  readonly sens: 'ACHAT' | 'VENTE';
  readonly quantite: number;
  readonly prixEntree: number;
  readonly ouvertLe: number;
  readonly origine: OrigineMarqueur;
  readonly raisonnement: string | null;
}

export interface SortiePosition {
  readonly id: string;
  readonly symbole: string;
  readonly sens: 'ACHAT' | 'VENTE';
  readonly prixSortie: number;
  readonly pnl: number | null;
  readonly motif: string | null;
  readonly fermeLe: number;
  readonly origine: OrigineMarqueur;
}

export interface RefusDecision {
  readonly id: string;
  readonly symbole: string;
  readonly sens: 'ACHAT' | 'VENTE';
  readonly quantite: number;
  readonly horodatage: number;
  readonly statut: string;
  readonly raison: string;
}

/** Reprend la forme attendue par le graphique, sans importer lightweight-charts
 *  ici : ce module doit rester testable hors navigateur. */
export interface Marqueur {
  readonly id: string;
  readonly horodatage: number;
  readonly position: 'aboveBar' | 'belowBar' | 'inBar';
  readonly forme: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  readonly couleur: string;
  readonly etiquette: string;
  readonly raisonnement: string;
}

const COULEUR_ACHAT = '#22c55e';
const COULEUR_VENTE = '#ef4444';
const COULEUR_REFUS = '#7b8798';
const COULEUR_SORTIE_GAIN = '#22c55e';
const COULEUR_SORTIE_PERTE = '#ef4444';

const LIBELLES_MOTIFS: Readonly<Record<string, string>> = {
  STOP_LOSS: 'stop touché',
  TAKE_PROFIT: 'cible atteinte',
  MANUEL: 'fermeture manuelle',
  LIQUIDATION: 'liquidation — marge insuffisante',
  EXPIRATION: 'expiration',
};

const LIBELLES_REFUS: Readonly<Record<string, string>> = {
  REJETEE_RISQUE: 'refusée par le moteur de risque',
  REFUSEE_PERMISSION: 'refusée — permission de l’agent',
  REFUSEE_UTILISATEUR: 'refusée par vous',
  EXPIREE: 'expirée avant validation',
};

function tronquer(texte: string, limite = 400): string {
  const propre = texte.trim();
  return propre.length > limite ? `${propre.slice(0, limite)}…` : propre;
}

function signe(valeur: number): string {
  return valeur >= 0 ? `+${valeur.toFixed(2)}` : valeur.toFixed(2);
}

export interface SourcesMarqueurs {
  readonly entrees: readonly EntreePosition[];
  readonly sorties: readonly SortiePosition[];
  readonly refus: readonly RefusDecision[];
}

/**
 * Construit les marqueurs d'un symbole pour un intervalle donné.
 *
 * L'alignement sur l'ouverture de bougie est indispensable : une décision
 * prise à 10 h 03 sur un graphique M5 appartient à la bougie de 10 h 00.
 * lightweight-charts n'affiche rien pour un horodatage qui ne correspond à
 * aucune bougie — le marqueur disparaîtrait en silence.
 */
export function construireMarqueurs(
  sources: SourcesMarqueurs,
  symbole: string,
  intervalle: Intervalle,
): readonly Marqueur[] {
  const marqueurs: Marqueur[] = [];

  for (const entree of sources.entrees) {
    if (entree.symbole !== symbole) continue;
    const achat = entree.sens === 'ACHAT';

    marqueurs.push({
      id: `entree-${entree.id}`,
      horodatage: debutBougie(entree.ouvertLe, intervalle),
      position: achat ? 'belowBar' : 'aboveBar',
      forme: achat ? 'arrowUp' : 'arrowDown',
      couleur: achat ? COULEUR_ACHAT : COULEUR_VENTE,
      etiquette: `${achat ? 'Achat' : 'Vente'} ${entree.quantite}`,
      raisonnement: tronquer(
        [
          `${entree.origine === 'AGENT' ? 'Décision des agents' : 'Ordre manuel'} — ${achat ? 'achat' : 'vente'} de ${entree.quantite} lot(s) à ${entree.prixEntree}.`,
          entree.raisonnement ?? '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    });
  }

  for (const sortie of sources.sorties) {
    if (sortie.symbole !== symbole) continue;
    const gagnante = (sortie.pnl ?? 0) >= 0;
    const motif = sortie.motif ? (LIBELLES_MOTIFS[sortie.motif] ?? sortie.motif) : 'sortie';

    marqueurs.push({
      id: `sortie-${sortie.id}`,
      horodatage: debutBougie(sortie.fermeLe, intervalle),
      // Symétrique de l'entrée : une position acheteuse se ferme par une
      // vente, donc le marqueur pointe dans l'autre sens.
      position: sortie.sens === 'ACHAT' ? 'aboveBar' : 'belowBar',
      forme: 'square',
      couleur: gagnante ? COULEUR_SORTIE_GAIN : COULEUR_SORTIE_PERTE,
      // Le résultat est un fait mesuré, jamais une promesse : on l'affiche tel
      // quel, pertes comprises.
      etiquette: sortie.pnl === null ? 'Sortie' : signe(sortie.pnl),
      raisonnement: tronquer(
        `Position fermée à ${sortie.prixSortie} (${motif}). Résultat : ${sortie.pnl === null ? 'donnée manquante' : signe(sortie.pnl)}.`,
      ),
    });
  }

  for (const refuse of sources.refus) {
    if (refuse.symbole !== symbole) continue;

    marqueurs.push({
      id: `refus-${refuse.id}`,
      horodatage: debutBougie(refuse.horodatage, intervalle),
      position: 'inBar',
      forme: 'circle',
      couleur: COULEUR_REFUS,
      etiquette: refuse.sens === 'ACHAT' ? '✕ achat' : '✕ vente',
      raisonnement: tronquer(
        `Proposition non exécutée — ${LIBELLES_REFUS[refuse.statut] ?? refuse.statut}.\n${refuse.sens} ${refuse.quantite} lot(s).\n${refuse.raison}`,
      ),
    });
  }

  // Tri chronologique : plusieurs marqueurs peuvent tomber sur la même bougie
  // après alignement, et lightweight-charts exige un ordre croissant.
  return marqueurs.sort((a, b) => a.horodatage - b.horodatage);
}
