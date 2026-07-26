import { randomUUID } from 'node:crypto';

import {
  arrondirAuPas,
  commission,
  demiSpread,
  prixExecution,
  profitPerte,
  slippage,
  swap,
} from './couts';
import { appelDeMarge, margeRequise, positionALiquider } from './marge';
import { marcheOuvert, nombreRollovers } from './seances';
import type {
  ContexteBougie,
  Ecriture,
  EtatMoteur,
  EtatPortefeuille,
  Evenement,
  MotifSortie,
  OrdreEnAttente,
  PositionOuverte,
  ResultatBougie,
  Sens,
} from './types';

/**
 * Moteur d'exécution simulé.
 *
 * Une seule implémentation sert le papier et le backtest : la différence tient
 * uniquement à qui appelle `traiterBougie` — une boucle sur l'historique, ou
 * l'arrivée d'une bougie fermée en direct. C'est ce qui garantit qu'un backtest
 * mesure bien le système qui tradera.
 *
 * ═══ Règle cardinale : aucun look-ahead ═══
 * Un ordre porte l'horodatage de la bougie sur laquelle la décision a été
 * prise. `traiterBougie` refuse tout remplissage sur une bougie dont
 * l'horodatage n'est pas **strictement postérieur**. C'est le piège numéro un
 * du backtesting : décider en voyant la clôture puis exécuter à l'ouverture de
 * la même bougie donne des résultats spectaculaires et entièrement faux.
 */

/**
 * Les identifiants sont des UUID, pas des compteurs : le moteur crée les
 * positions et les ordres, et ces mêmes identifiants deviennent les clés
 * primaires en base. Sans ça, il faudrait une table de correspondance entre
 * l'état en mémoire et l'état persisté à chaque écriture.
 */
function identifiant(): string {
  return randomUUID();
}

interface Accumulateur {
  portefeuille: EtatPortefeuille;
  ordres: OrdreEnAttente[];
  positions: PositionOuverte[];
  evenements: Evenement[];
  ecritures: Ecriture[];
}

/**
 * Traite une bougie de bout en bout.
 *
 * Ordre des opérations, volontairement figé :
 *   1. expiration des ordres échus ;
 *   2. stops et take-profits des positions ouvertes ;
 *   3. remplissage des ordres en attente ;
 *   4. frais de portage aux passages de rollover ;
 *   5. réévaluation de l'équité, puis appel de marge et liquidation.
 *
 * Les stops sont évalués **avant** les nouveaux remplissages : une position
 * déjà ouverte doit pouvoir être coupée par la bougie qui, par ailleurs,
 * déclenche une entrée.
 */
export function traiterBougie(etat: EtatMoteur, contexte: ContexteBougie): ResultatBougie {
  const acc: Accumulateur = {
    portefeuille: etat.portefeuille,
    ordres: [...etat.ordres],
    positions: [...etat.positions],
    evenements: [],
    ecritures: [],
  };

  const { bougie, instrument, tauxCotationVersCompte: taux } = contexte;

  expirerOrdres(acc, bougie.horodatage);
  if (taux !== null) {
    appliquerSortiesAutomatiques(acc, contexte, taux);
    remplirOrdres(acc, contexte, taux);
    appliquerSwaps(acc, contexte, taux);
  }

  acc.portefeuille = reevaluer(acc.portefeuille, acc.positions, contexte, taux);

  if (taux !== null && appelDeMarge(acc.portefeuille, contexte.parametres)) {
    liquider(acc, contexte, taux);
  }

  void instrument;
  return { etat: { portefeuille: acc.portefeuille, ordres: acc.ordres, positions: acc.positions }, evenements: acc.evenements, ecritures: acc.ecritures };
}

// --- 1. Expiration ---------------------------------------------------------

function expirerOrdres(acc: Accumulateur, horodatage: number): void {
  const restants: OrdreEnAttente[] = [];
  for (const ordre of acc.ordres) {
    if (ordre.valideJusqua !== null && horodatage > ordre.valideJusqua) {
      acc.evenements.push({
        type: 'ORDRE_EXPIRE',
        horodatage,
        ordreId: ordre.id,
        detail: `Ordre expiré sans remplissage (validité dépassée).`,
      });
      continue;
    }
    restants.push(ordre);
  }
  acc.ordres = restants;
}

// --- 2. Stops et take-profits ---------------------------------------------

function appliquerSortiesAutomatiques(
  acc: Accumulateur,
  contexte: ContexteBougie,
  taux: number,
): void {
  const { bougie } = contexte;
  const restantes: PositionOuverte[] = [];

  for (const position of acc.positions) {
    const sortie = detecterSortie(position, contexte);
    if (!sortie) {
      restantes.push(position);
      continue;
    }
    fermerPosition(acc, position, sortie.prix, sortie.motif, bougie.horodatage, contexte, taux);
  }

  acc.positions = restantes;
}

/**
 * Quand une bougie contient **à la fois** le stop et la cible, on ne peut pas
 * savoir lequel a été touché en premier sans données intra-bougie. On retient
 * le stop : c'est l'hypothèse défavorable, la seule honnête pour une
 * simulation.
 */
function detecterSortie(
  position: PositionOuverte,
  contexte: ContexteBougie,
): { prix: number; motif: MotifSortie } | null {
  const { bougie, instrument } = contexte;
  const marge = demiSpread(instrument) + slippage(contexte, position.quantite);

  const stopTouche =
    position.stopLoss !== null &&
    (position.sens === 'ACHAT' ? bougie.bas <= position.stopLoss : bougie.haut >= position.stopLoss);

  if (stopTouche && position.stopLoss !== null) {
    // Ouverture au-delà du stop (gap) : on est servi au prix d'ouverture,
    // pas au stop. C'est là que se logent les pertes supérieures au risque prévu.
    const gap =
      position.sens === 'ACHAT'
        ? bougie.ouverture < position.stopLoss
        : bougie.ouverture > position.stopLoss;
    const base = gap ? bougie.ouverture : position.stopLoss;
    const prix = position.sens === 'ACHAT' ? base - marge : base + marge;
    return { prix: arrondirAuPas(prix, instrument), motif: 'STOP_LOSS' };
  }

  const cibleTouchee =
    position.takeProfit !== null &&
    (position.sens === 'ACHAT'
      ? bougie.haut >= position.takeProfit
      : bougie.bas <= position.takeProfit);

  if (cibleTouchee && position.takeProfit !== null) {
    // Un take-profit est un ordre limite : servi au prix demandé, sans
    // slippage, mais le spread s'applique toujours.
    const demi = demiSpread(instrument);
    const prix =
      position.sens === 'ACHAT' ? position.takeProfit - demi : position.takeProfit + demi;
    return { prix: arrondirAuPas(prix, instrument), motif: 'TAKE_PROFIT' };
  }

  return null;
}

// --- 3. Remplissage des ordres --------------------------------------------

function remplirOrdres(acc: Accumulateur, contexte: ContexteBougie, taux: number): void {
  const { bougie, instrument, parametres } = contexte;
  const restants: OrdreEnAttente[] = [];

  for (const ordre of acc.ordres) {
    // ═══ Barrière anti-look-ahead ═══
    if (bougie.horodatage <= ordre.horodatageDecision) {
      restants.push(ordre);
      continue;
    }

    if (!marcheOuvert(instrument, bougie.horodatage)) {
      restants.push(ordre);
      continue;
    }

    const declenchement = prixDeclenchement(ordre, contexte);
    if (declenchement === null) {
      restants.push(ordre);
      continue;
    }

    const aPourvoir = ordre.quantite - ordre.quantiteRemplie;
    const capacite = parametres.liquiditeParBougie;
    const quantite = capacite === null ? aPourvoir : Math.min(aPourvoir, capacite);

    if (quantite <= 0) {
      restants.push(ordre);
      continue;
    }

    const marge = margeRequise(instrument, quantite, declenchement, taux, parametres);
    if (marge > acc.portefeuille.equite - acc.portefeuille.margeUtilisee) {
      acc.evenements.push({
        type: 'ORDRE_REJETE',
        horodatage: bougie.horodatage,
        ordreId: ordre.id,
        detail: 'Marge libre insuffisante au moment du remplissage.',
      });
      continue;
    }

    ouvrirPosition(acc, ordre, quantite, declenchement, marge, contexte);

    const remplieTotale = ordre.quantiteRemplie + quantite;
    if (remplieTotale < ordre.quantite) {
      acc.evenements.push({
        type: 'ORDRE_PARTIELLEMENT_REMPLI',
        horodatage: bougie.horodatage,
        ordreId: ordre.id,
        quantite,
        prix: declenchement,
        detail: `Liquidité de la bougie limitée à ${quantite} lot(s) ; reste ${
          ordre.quantite - remplieTotale
        }.`,
      });
      restants.push({ ...ordre, quantiteRemplie: remplieTotale });
    } else {
      acc.evenements.push({
        type: 'ORDRE_REMPLI',
        horodatage: bougie.horodatage,
        ordreId: ordre.id,
        quantite,
        prix: declenchement,
        detail: `Ordre ${ordre.type.toLowerCase()} rempli.`,
      });
    }
  }

  acc.ordres = restants;
}

/** Prix auquel l'ordre serait servi sur cette bougie, ou `null` s'il ne l'est pas. */
function prixDeclenchement(ordre: OrdreEnAttente, contexte: ContexteBougie): number | null {
  const { bougie, instrument } = contexte;
  const quantite = ordre.quantite - ordre.quantiteRemplie;

  if (ordre.type === 'MARCHE') {
    // Ouverture de la bougie suivante : le premier prix réellement accessible
    // après la décision.
    return prixExecution(bougie.ouverture, ordre.sens, contexte, quantite);
  }

  if (ordre.prixDemande === null) return null;
  const niveau = ordre.prixDemande;
  const demi = demiSpread(instrument);

  if (ordre.type === 'LIMITE') {
    const touche = ordre.sens === 'ACHAT' ? bougie.bas <= niveau : bougie.haut >= niveau;
    if (!touche) return null;
    // Ouverture déjà au-delà de la limite : on est servi au meilleur prix.
    const base =
      ordre.sens === 'ACHAT' ? Math.min(niveau, bougie.ouverture) : Math.max(niveau, bougie.ouverture);
    const prix = ordre.sens === 'ACHAT' ? base + demi : base - demi;
    return arrondirAuPas(prix, instrument);
  }

  // STOP : déclenché au franchissement, avec slippage — c'est justement le cas
  // où le marché va vite.
  const touche = ordre.sens === 'ACHAT' ? bougie.haut >= niveau : bougie.bas <= niveau;
  if (!touche) return null;
  const gap = ordre.sens === 'ACHAT' ? bougie.ouverture > niveau : bougie.ouverture < niveau;
  const base = gap ? bougie.ouverture : niveau;
  return prixExecution(base, ordre.sens, contexte, quantite);
}

// --- Ouverture et fermeture ------------------------------------------------

function ouvrirPosition(
  acc: Accumulateur,
  ordre: OrdreEnAttente,
  quantite: number,
  prix: number,
  marge: number,
  contexte: ContexteBougie,
): void {
  const frais = commission(contexte.instrument, quantite);
  const solde = acc.portefeuille.solde - frais;

  acc.ecritures.push({
    type: 'COMMISSION',
    horodatage: contexte.bougie.horodatage,
    montant: -frais,
    soldeApres: solde,
    positionId: null,
    description: `Commission d'ouverture ${contexte.instrument.code}`,
  });

  const position: PositionOuverte = {
    id: identifiant(),
    instrument: contexte.instrument.code,
    sens: ordre.sens,
    quantite,
    prixEntree: prix,
    stopLoss: ordre.stopLoss,
    takeProfit: ordre.takeProfit,
    margeImmobilisee: marge,
    commissionTotale: frais,
    swapTotal: 0,
    ouvertLe: contexte.bougie.horodatage,
    dernierSwapLe: contexte.bougie.horodatage,
  };

  acc.positions.push(position);
  acc.portefeuille = {
    ...acc.portefeuille,
    solde,
    margeUtilisee: acc.portefeuille.margeUtilisee + marge,
  };

  acc.evenements.push({
    type: 'POSITION_OUVERTE',
    horodatage: contexte.bougie.horodatage,
    positionId: position.id,
    ordreId: ordre.id,
    quantite,
    prix,
    detail: `${ordre.sens} ${quantite} lot(s) ${contexte.instrument.code} à ${prix}`,
  });
}

function fermerPosition(
  acc: Accumulateur,
  position: PositionOuverte,
  prix: number,
  motif: MotifSortie,
  horodatage: number,
  contexte: ContexteBougie,
  taux: number,
): void {
  const resultat = profitPerte(
    contexte.instrument,
    position.sens,
    position.quantite,
    position.prixEntree,
    prix,
    taux,
  );

  const solde = acc.portefeuille.solde + resultat;

  acc.ecritures.push({
    type: 'PROFIT_PERTE',
    horodatage,
    montant: resultat,
    soldeApres: solde,
    positionId: position.id,
    description: `Fermeture ${position.instrument} (${motif})`,
  });

  acc.portefeuille = {
    ...acc.portefeuille,
    solde,
    margeUtilisee: Math.max(0, acc.portefeuille.margeUtilisee - position.margeImmobilisee),
  };

  acc.evenements.push({
    type: 'POSITION_FERMEE',
    horodatage,
    positionId: position.id,
    quantite: position.quantite,
    prix,
    montant: resultat,
    motif,
    detail: `Position fermée à ${prix} (${motif}), résultat ${resultat.toFixed(2)}`,
  });
}

// --- 4. Frais de portage ---------------------------------------------------

function appliquerSwaps(acc: Accumulateur, contexte: ContexteBougie, taux: number): void {
  const { bougie, instrument } = contexte;
  const misesAJour: PositionOuverte[] = [];

  for (const position of acc.positions) {
    const depuis = position.dernierSwapLe ?? position.ouvertLe;
    const nuits = nombreRollovers(depuis, bougie.horodatage);
    if (nuits === 0) {
      misesAJour.push(position);
      continue;
    }

    const montant = swap(instrument, position.sens, position.quantite, nuits, taux);
    const solde = acc.portefeuille.solde + montant;

    acc.ecritures.push({
      type: 'SWAP',
      horodatage: bougie.horodatage,
      montant,
      soldeApres: solde,
      positionId: position.id,
      description: `Portage ${nuits} nuit(s) ${instrument.code}`,
    });
    acc.evenements.push({
      type: 'SWAP_APPLIQUE',
      horodatage: bougie.horodatage,
      positionId: position.id,
      montant,
      detail: `${nuits} nuit(s) de portage`,
    });

    acc.portefeuille = { ...acc.portefeuille, solde };
    misesAJour.push({
      ...position,
      swapTotal: position.swapTotal + montant,
      dernierSwapLe: bougie.horodatage,
    });
  }

  acc.positions = misesAJour;
}

// --- 5. Réévaluation et appel de marge -------------------------------------

export function pnlLatent(
  position: PositionOuverte,
  contexte: ContexteBougie,
  taux: number,
): number {
  return profitPerte(
    contexte.instrument,
    position.sens,
    position.quantite,
    position.prixEntree,
    contexte.bougie.cloture,
    taux,
  );
}

function reevaluer(
  portefeuille: EtatPortefeuille,
  positions: readonly PositionOuverte[],
  contexte: ContexteBougie,
  taux: number | null,
): EtatPortefeuille {
  const latent =
    taux === null
      ? 0
      : positions.reduce((somme, position) => somme + pnlLatent(position, contexte, taux), 0);

  const equite = portefeuille.solde + latent;

  return {
    ...portefeuille,
    equite,
    // Le sommet ne redescend jamais : c'est la référence du drawdown.
    sommetEquite: Math.max(portefeuille.sommetEquite, equite),
  };
}

function liquider(acc: Accumulateur, contexte: ContexteBougie, taux: number): void {
  const parametres = contexte.parametres;

  // On ferme une position à la fois et on réévalue : liquider tout d'un coup
  // exagérerait les pertes par rapport au comportement réel d'un courtier.
  while (acc.positions.length > 0 && appelDeMarge(acc.portefeuille, parametres)) {
    const latents = new Map(
      acc.positions.map((position) => [position.id, pnlLatent(position, contexte, taux)]),
    );
    const cible = positionALiquider(acc.positions, latents);
    if (!cible) break;

    const prix = prixExecution(
      contexte.bougie.cloture,
      cible.sens === 'ACHAT' ? 'VENTE' : 'ACHAT',
      contexte,
      cible.quantite,
    );

    acc.evenements.push({
      type: 'APPEL_MARGE',
      horodatage: contexte.bougie.horodatage,
      positionId: cible.id,
      detail: 'Niveau de marge sous le seuil : liquidation de la position la plus perdante.',
    });

    acc.positions = acc.positions.filter((position) => position.id !== cible.id);
    fermerPosition(acc, cible, prix, 'LIQUIDATION', contexte.bougie.horodatage, contexte, taux);
    acc.portefeuille = reevaluer(acc.portefeuille, acc.positions, contexte, taux);
  }
}

// --- Fermeture manuelle ----------------------------------------------------

/** Fermeture explicite, hors stop et hors cible. Utilisée par l'UI et par le PM. */
export function fermerManuellement(
  etat: EtatMoteur,
  positionId: string,
  contexte: ContexteBougie,
  motif: MotifSortie = 'FERMETURE_MANUELLE',
): ResultatBougie {
  const taux = contexte.tauxCotationVersCompte;
  const position = etat.positions.find((candidate) => candidate.id === positionId);

  if (!position || taux === null) {
    return { etat, evenements: [], ecritures: [] };
  }

  const acc: Accumulateur = {
    portefeuille: etat.portefeuille,
    ordres: [...etat.ordres],
    positions: etat.positions.filter((candidate) => candidate.id !== positionId),
    evenements: [],
    ecritures: [],
  };

  const sensSortie: Sens = position.sens === 'ACHAT' ? 'VENTE' : 'ACHAT';
  const prix = prixExecution(contexte.bougie.cloture, sensSortie, contexte, position.quantite);

  fermerPosition(acc, position, prix, motif, contexte.bougie.horodatage, contexte, taux);
  acc.portefeuille = reevaluer(acc.portefeuille, acc.positions, contexte, taux);

  return {
    etat: { portefeuille: acc.portefeuille, ordres: acc.ordres, positions: acc.positions },
    evenements: acc.evenements,
    ecritures: acc.ecritures,
  };
}

/** Crée un ordre en attente. La décision est datée de la bougie courante :
 *  le remplissage ne pourra donc jamais avoir lieu avant la suivante. */
export function creerOrdre(
  parametres: Omit<OrdreEnAttente, 'id' | 'quantiteRemplie'>,
): OrdreEnAttente {
  return { ...parametres, id: identifiant(), quantiteRemplie: 0 };
}
