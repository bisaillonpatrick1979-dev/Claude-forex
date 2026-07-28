import { MODELES_PAR_FOURNISSEUR } from './tarifs';
import {
  estimerTokens,
  type AdaptateurLLM,
  type ContexteDeterministe,
  type DemandeLLM,
  type ReponseLLM,
} from './types';

/**
 * Adaptateur de simulation. Aucun réseau, aucun coût, sortie reproductible.
 *
 * Ce n'est pas un bouchon de test : c'est le fournisseur par défaut des douze
 * agents à la création du compte. Un cycle complet — analyse, débat, synthèse,
 * proposition, contrôle de risque, décision — tourne donc de bout en bout sans
 * qu'aucune clé API n'ait été saisie, et l'utilisateur voit la mécanique
 * avant de décider s'il veut la payer.
 *
 * Les niveaux cités proviennent exclusivement de `contexteDeterministe`,
 * c'est-à-dire de l'instantané de marché réel. Le mock ne peut donc pas
 * inventer un prix, exactement comme on l'exige d'un vrai agent.
 */

/** Hachage FNV-1a : rend un cycle rejouable à l'identique pour un même prompt. */
function graine(texte: string): number {
  let valeur = 0x811c9dc5;
  for (let index = 0; index < texte.length; index += 1) {
    valeur ^= texte.charCodeAt(index);
    valeur = Math.imul(valeur, 0x01000193) >>> 0;
  }
  return valeur;
}

function suite(depart: number): () => number {
  let etat = depart || 1;
  return () => {
    etat ^= etat << 13;
    etat >>>= 0;
    etat ^= etat >> 17;
    etat ^= etat << 5;
    etat >>>= 0;
    return etat / 0xffffffff;
  };
}

function arrondir(valeur: number, decimales: number): number {
  const facteur = 10 ** decimales;
  return Math.round(valeur * facteur) / facteur;
}

const CONTEXTE_PAR_DEFAUT: ContexteDeterministe = {
  symbole: 'INSTRUMENT',
  dernierPrix: 1,
  atr: null,
  decimales: 5,
};

function corpsSelonFormat(
  format: string | null | undefined,
  ancrage: ContexteDeterministe,
  hasard: () => number,
): string {
  const { symbole, dernierPrix, decimales } = ancrage;
  // Sans ATR on prend 0,4 % du prix : une amplitude plausible, jamais présentée
  // comme mesurée.
  const amplitude = ancrage.atr ?? dernierPrix * 0.004;
  const haussier = hasard() > 0.45;
  const conviction = 40 + Math.floor(hasard() * 35);

  const entree = arrondir(dernierPrix, decimales);
  const stop = arrondir(haussier ? dernierPrix - amplitude * 1.5 : dernierPrix + amplitude * 1.5, decimales);
  const cible = arrondir(haussier ? dernierPrix + amplitude * 3 : dernierPrix - amplitude * 3, decimales);
  const invalidation = stop;

  switch (format) {
    case 'vue_marche':
      return [
        '```json',
        JSON.stringify(
          {
            direction: conviction < 45 ? 'NEUTRE' : haussier ? 'HAUSSIER' : 'BAISSIER',
            conviction,
            horizon: 'intraday',
            niveau_invalidation: invalidation,
            resume: `Simulation : structure ${haussier ? 'haussière' : 'baissière'} sur ${symbole}, invalidée sous/au-dessus de ${invalidation}.`,
          },
          null,
          2,
        ),
        '```',
      ].join('\n');

    case 'proposition':
      if (conviction < 45) {
        return [
          'Conviction insuffisante : je préfère ne rien faire.',
          '```json',
          JSON.stringify({ action: 'ABSTENTION', raisonnement: 'Conviction sous le seuil.' }, null, 2),
          '```',
        ].join('\n');
      }
      return [
        `Proposition simulée sur ${symbole}.`,
        '```json',
        JSON.stringify(
          {
            action: 'ORDRE',
            sens: haussier ? 'ACHAT' : 'VENTE',
            type_ordre: 'MARCHE',
            quantite: 0.5,
            prix_entree: entree,
            stop_loss: stop,
            take_profit: cible,
            validite_minutes: 120,
            raisonnement: `Entrée ${entree}, stop ${stop}, cible ${cible} — ratio 2:1 sur l'amplitude récente.`,
          },
          null,
          2,
        ),
        '```',
      ].join('\n');

    case 'decision_pm':
      return [
        '```json',
        JSON.stringify(
          {
            decision: conviction >= 50 ? 'APPROUVE' : 'REFUSE',
            justification:
              conviction >= 50
                ? 'Simulation : proposition cohérente avec la vue, taille compatible avec le portefeuille.'
                : 'Simulation : conviction trop faible pour engager du capital.',
          },
          null,
          2,
        ),
        '```',
      ].join('\n');

    case 'lecon':
      return [
        '```json',
        JSON.stringify(
          {
            titre: `Simulation — comportement de ${symbole} autour de ${entree}`,
            contenu: `Position clôturée près de ${entree}. À rejouer : vérifier que le stop laissait respirer une amplitude de ${arrondir(amplitude, decimales)} avant l'entrée.`,
            etiquettes: [symbole, 'simulation'],
          },
          null,
          2,
        ),
        '```',
      ].join('\n');

    default:
      return [
        `Analyse simulée de ${symbole}.`,
        `Dernier prix retenu : ${entree}. Amplitude de référence : ${arrondir(amplitude, decimales)}.`,
        `Biais : ${haussier ? 'acheteur' : 'vendeur'}, confiance ${conviction}/100.`,
        'Aucun modèle de langage n’a été appelé : ce texte est produit localement à des fins de démonstration.',
      ].join('\n');
  }
}

/**
 * Découpe en morceaux de la taille d'un mot, comme les rend un vrai modèle.
 *
 * Le séparateur reste attaché au morceau qui le précède : recoller la suite
 * doit redonner le texte exact, espaces compris. Un mock qui perdrait un
 * espace ferait chercher un défaut d'affichage inexistant.
 */
function decouper(texte: string): readonly string[] {
  return texte.match(/\S+\s*|\s+/g) ?? [];
}

/** Assez lent pour qu'on voie écrire, assez rapide pour ne pas rallonger un
 *  cycle complet de douze agents au-delà du raisonnable. */
const TEMPO_FRAGMENT_MS = 12;

function pause(millisecondes: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, millisecondes));
}

export const adaptateurMock: AdaptateurLLM = {
  code: 'mock',
  nom: 'Simulation locale',
  necessiteCle: false,
  modeles: MODELES_PAR_FOURNISSEUR.mock,

  async appeler(demande: DemandeLLM): Promise<ReponseLLM> {
    const debut = Date.now();
    const empreinte = graine(
      demande.systeme + demande.messages.map((message) => message.contenu).join('\n'),
    );
    const contenu = corpsSelonFormat(
      demande.formatJson,
      demande.contexteDeterministe ?? CONTEXTE_PAR_DEFAUT,
      suite(empreinte),
    );

    const entree = demande.systeme + demande.messages.map((message) => message.contenu).join('');

    // Le mock imite aussi la *façon* dont le texte arrive, pas seulement son
    // contenu. Sans ça, le fil en streaming ne serait jamais exerçable sans
    // dépenser un dollar — et un défaut d'affichage ne se verrait qu'en
    // production, sur des tokens facturés.
    if (demande.surFragment) {
      for (const morceau of decouper(contenu)) {
        demande.surFragment(morceau);
        await pause(TEMPO_FRAGMENT_MS);
      }
    }

    return {
      contenu,
      tokensEntree: estimerTokens(entree),
      tokensSortie: estimerTokens(contenu),
      latenceMs: Date.now() - debut,
      modele: demande.modele,
      tronquee: false,
    };
  },
};
