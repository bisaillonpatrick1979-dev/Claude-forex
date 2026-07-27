/**
 * Alertes de niveau : détection de franchissement.
 *
 * Ce module reproduit, en TypeScript testable, la logique déjà déployée dans la
 * fonction Edge `surveillance-alertes`. Elle y vivait sans test et hors du
 * dépôt ; la remettre ici permet de la vérifier, et de la partager avec le
 * chemin applicatif quand un prix arrive par la salle des marchés plutôt que
 * par le cron.
 *
 * **Le problème que résout la machine à trois états.** Comparer le prix au
 * niveau ne suffit pas : si le cours est au-dessus, l'a-t-il franchi à
 * l'instant ou depuis trois jours ? Il faut donc mémoriser de quel côté il
 * était. Mais deux côtés ne suffisent pas non plus — un cours qui vibre autour
 * du niveau bascule alors à chaque tick, et l'alerte sonne vingt fois pour un
 * seul événement.
 *
 * D'où la zone morte et le troisième état :
 *
 *     prix > niveau + zone morte  →  dessus
 *     prix < niveau − zone morte  →  dessous
 *     entre les deux              →  dedans
 *
 * Un franchissement n'est reconnu que sur `dessous → dessus` ou l'inverse. Le
 * passage par `dedans` absorbe le bruit sans jamais masquer un vrai mouvement,
 * puisqu'il faut traverser toute la zone pour changer de côté.
 *
 * Le suivi d'état est **découplé** du déclenchement : le côté est mis à jour
 * même quand la direction ne correspond pas à ce que l'alerte surveille. Les
 * confondre désynchroniserait la machine — une alerte haussière cesserait de
 * voir les descentes, et ne pourrait donc plus jamais détecter la remontée.
 */

export const COTES = ['dessus', 'dessous', 'dedans'] as const;
export type Cote = (typeof COTES)[number];

export const DIRECTIONS = ['haussier', 'baissier', 'les_deux'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const LIBELLES_DIRECTION: Readonly<Record<Direction, string>> = {
  haussier: 'franchissement à la hausse',
  baissier: 'franchissement à la baisse',
  les_deux: 'franchissement dans les deux sens',
};

export interface Alerte {
  readonly id: string;
  readonly symbole: string;
  readonly niveau: number;
  /** Demi-largeur de la bande neutre autour du niveau, en prix. */
  readonly zoneMorte: number;
  readonly direction: Direction;
  readonly derniereCote: Cote | null;
  readonly usageUnique: boolean;
  readonly libelleAnnotation: string | null;
}

export interface Franchissement {
  readonly alerte: Alerte;
  readonly sens: 'haussier' | 'baissier';
  readonly prix: number;
  readonly message: string;
}

export interface MiseAJourCote {
  readonly id: string;
  readonly cote: Cote;
  readonly prix: number;
  readonly desactiver: boolean;
}

export interface ResultatSurveillance {
  readonly franchissements: readonly Franchissement[];
  readonly misesAJour: readonly MiseAJourCote[];
}

/** De quel côté du niveau se trouve le prix, zone morte comprise. */
export function determinerCote(prix: number, niveau: number, zoneMorte: number): Cote {
  const marge = Math.abs(zoneMorte);
  if (prix > niveau + marge) return 'dessus';
  if (prix < niveau - marge) return 'dessous';
  return 'dedans';
}

/**
 * Zone morte suggérée pour un niveau.
 *
 * Proportionnelle au prix plutôt que fixe : deux points de spread sur EUR/USD
 * ne représentent pas la même chose que deux points sur NAS100. Un demi-dix-
 * millième couvre le spread typique d'une paire majeure sans avaler un
 * mouvement réel.
 */
export function zoneMorteSuggeree(niveau: number): number {
  return Math.abs(niveau) * 0.00005;
}

export function surveiller(
  alertes: readonly Alerte[],
  prixParSymbole: ReadonlyMap<string, number>,
  decimales = 5,
): ResultatSurveillance {
  const franchissements: Franchissement[] = [];
  const misesAJour: MiseAJourCote[] = [];

  for (const alerte of alertes) {
    const prix = prixParSymbole.get(alerte.symbole);
    // Symbole indisponible ce tour-ci : on ne touche pas à l'état. Écrire un
    // côté à partir d'un prix qu'on n'a pas obtenu inventerait un mouvement.
    if (prix === undefined || !Number.isFinite(prix)) continue;

    const cote = determinerCote(prix, alerte.niveau, alerte.zoneMorte);

    const sens =
      alerte.derniereCote === 'dessous' && cote === 'dessus'
        ? 'haussier'
        : alerte.derniereCote === 'dessus' && cote === 'dessous'
          ? 'baissier'
          : null;

    const retenu =
      sens !== null && (alerte.direction === 'les_deux' || alerte.direction === sens);

    if (retenu && sens) {
      franchissements.push({
        alerte,
        sens,
        prix,
        message: rediger(alerte, sens, prix, decimales),
      });
    }

    misesAJour.push({
      id: alerte.id,
      cote,
      prix,
      desactiver: retenu && alerte.usageUnique,
    });
  }

  return { franchissements, misesAJour };
}

function rediger(
  alerte: Alerte,
  sens: 'haussier' | 'baissier',
  prix: number,
  decimales: number,
): string {
  const p = (valeur: number) => valeur.toFixed(decimales);
  const nom = alerte.libelleAnnotation?.trim();
  const sujet = nom ? `« ${nom} » (${p(alerte.niveau)})` : `le niveau ${p(alerte.niveau)}`;
  const verbe = sens === 'haussier' ? 'franchi à la hausse' : 'franchi à la baisse';

  return `${alerte.symbole} a ${verbe} ${sujet}, à ${p(prix)}.`;
}

/**
 * Bloc d'événements remis aux agents.
 *
 * Un franchissement n'est pas un signal d'entrée : c'est un fait, daté, sur un
 * niveau que le trader avait jugé digne d'attention. La formulation le dit,
 * pour qu'un agent ne le lise pas comme un ordre déguisé.
 */
export function blocEvenements(
  evenements: readonly { symbole: string; niveau: number; prix: number; direction: string; libelleAnnotation: string | null; declencheLe: string }[],
  decimales: number,
): string {
  if (evenements.length === 0) return '';

  const lignes = evenements
    .map((evenement) => {
      const nom = evenement.libelleAnnotation?.trim();
      const sujet = nom ? `« ${nom} » (${evenement.niveau.toFixed(decimales)})` : evenement.niveau.toFixed(decimales);
      const verbe = evenement.direction === 'haussier' ? 'franchi à la hausse' : 'franchi à la baisse';
      return `- ${evenement.declencheLe} — ${evenement.symbole} a ${verbe} ${sujet}, à ${evenement.prix.toFixed(decimales)}.`;
    })
    .join('\n');

  return (
    'Niveaux franchis depuis la dernière délibération. Ce sont des faits datés, ' +
    'sur des niveaux que le trader avait jugés dignes d’attention — pas des signaux ' +
    'd’entrée. Un franchissement peut aussi bien invalider une hypothèse que la ' +
    'confirmer.\n' +
    lignes
  );
}
