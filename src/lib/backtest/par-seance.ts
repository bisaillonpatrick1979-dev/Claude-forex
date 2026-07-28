import { SEANCES, libelleSeance, seanceDe, type CodeSeance } from '@/lib/marche/seances-mondiales';

/**
 * Résultats découpés par séance de marché.
 *
 * C'est l'analytique que toutes les plateformes de journalisation
 * professionnelles mettent en avant, et pour une raison mesurable : le même
 * système ne rend pas la même chose à 3 h et à 14 h. Un trader qui gagne sur
 * Londres et rend tout sur Tokyo n'a pas un problème de stratégie, il a un
 * problème d'horaire — et un rendement global masque exactement cela.
 *
 * La séance est **déduite** de l'horodatage, jamais stockée. Aucune colonne à
 * remplir, aucune migration, et l'historique déjà en base se découpe
 * rétroactivement. Si les horaires sont corrigés un jour, tout l'historique se
 * corrige du même coup.
 *
 * Le rattachement se fait à l'**ouverture** de la position, pas à sa
 * fermeture : c'est au moment d'entrer qu'on choisit un régime de liquidité.
 * Une position ouverte sur Tokyo et fermée sur Londres est une décision prise
 * sur Tokyo — la fermeture, elle, est souvent l'affaire d'un stop.
 */

export interface TradeDate {
  /** Horodatage d'ouverture, en secondes UTC. */
  readonly ouvertLe: number;
  readonly pnl: number | null;
}

export interface ResultatSeance {
  readonly code: CodeSeance | 'HORS_SEANCE';
  readonly nom: string;
  readonly trades: number;
  /** Somme des P&L connus. Les trades sans P&L sont comptés mais exclus. */
  readonly pnl: number;
  /** `null` si aucun trade n'a de P&L : mieux vaut « inconnu » que 0 %. */
  readonly tauxReussitePct: number | null;
  /** Nombre de trades dont le P&L est inconnu, dit plutôt que caché. */
  readonly sansResultat: number;
}

/**
 * Ventile des trades par séance d'ouverture.
 *
 * Toutes les séances sont rendues, y compris celles sans aucun trade : une
 * séance vide est une information — elle dit que la firme n'y travaille pas.
 * La ligne « hors séance » n'apparaît que si elle contient quelque chose,
 * parce qu'elle ne devrait normalement rien contenir.
 */
export function resultatsParSeance(trades: readonly TradeDate[]): readonly ResultatSeance[] {
  const paniers = new Map<CodeSeance | 'HORS_SEANCE', TradeDate[]>();
  for (const seance of SEANCES) paniers.set(seance.code, []);

  for (const trade of trades) {
    const code = seanceDe(trade.ouvertLe) ?? 'HORS_SEANCE';
    const panier = paniers.get(code);
    if (panier) panier.push(trade);
    else paniers.set(code, [trade]);
  }

  const lignes: ResultatSeance[] = [];

  for (const [code, panier] of paniers) {
    if (code === 'HORS_SEANCE' && panier.length === 0) continue;

    const chiffres = panier.filter((trade) => trade.pnl !== null);
    const gagnants = chiffres.filter((trade) => (trade.pnl ?? 0) > 0).length;

    lignes.push({
      code,
      nom:
        code === 'HORS_SEANCE'
          ? 'Hors séance'
          : (SEANCES.find((seance) => seance.code === code)?.nom ?? code),
      trades: panier.length,
      pnl: chiffres.reduce((somme, trade) => somme + (trade.pnl ?? 0), 0),
      tauxReussitePct: chiffres.length === 0 ? null : (gagnants / chiffres.length) * 100,
      sansResultat: panier.length - chiffres.length,
    });
  }

  return lignes;
}

/**
 * Séance qui rapporte le plus, et celle qui coûte le plus.
 *
 * Rien n'est déduit d'un seul trade : sous le seuil, on rend `null` plutôt
 * qu'un verdict. Désigner « la meilleure séance » sur deux trades serait une
 * conclusion tirée du bruit, exactement ce que la validation statistique du
 * backtest existe pour empêcher ailleurs.
 */
export const TRADES_MINIMUM_POUR_CONCLURE = 5;

export function seancesRemarquables(lignes: readonly ResultatSeance[]): {
  readonly meilleure: ResultatSeance | null;
  readonly pire: ResultatSeance | null;
} {
  const eligibles = lignes.filter((ligne) => ligne.trades >= TRADES_MINIMUM_POUR_CONCLURE);
  if (eligibles.length < 2) return { meilleure: null, pire: null };

  const triees = [...eligibles].sort((a, b) => b.pnl - a.pnl);
  const meilleure = triees[0]!;
  const pire = triees[triees.length - 1]!;

  // Si tout le monde est à égalité, il n'y a rien à désigner.
  return meilleure.pnl === pire.pnl ? { meilleure: null, pire: null } : { meilleure, pire };
}

/** Libellé de la séance d'un trade, pour une pastille dans une liste. */
export function seanceDuTrade(ouvertLe: number): string {
  return libelleSeance(ouvertLe);
}
