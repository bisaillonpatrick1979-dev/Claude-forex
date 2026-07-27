import { dureeSecondes } from './intervalles';
import { weekEndForex } from './seances-mondiales';
import type { Chandelier, ClasseActif, Intervalle } from './types';

/**
 * Contrôle qualité d'une série historique.
 *
 * Un backtest sur quinze ans ne vaut que ce que valent ses bougies. Le piège
 * n'est pas la donnée manifestement absurde — celle-là se voit — mais la
 * donnée discrètement fausse : une bougie dupliquée, un horodatage décalé d'un
 * fuseau, un split d'action non ajusté qui divise le prix par quatre du jour au
 * lendemain. Chacune produit un backtest qui tourne, rend des chiffres, et ment.
 *
 * Deux principes tenus ici :
 *
 *  1. **On signale, on ne corrige pas.** Interpoler une bougie manquante
 *     fabrique un prix qui n'a jamais été coté. Une série trouée est
 *     exploitable si on sait où sont les trous ; une série rebouchée ne l'est
 *     plus, et rien ne le dit.
 *
 *  2. **Un trou de marché n'est pas une anomalie.** Le Forex ne cote pas du
 *     vendredi soir au dimanche soir, les actions ferment la nuit et les jours
 *     fériés. Compter ces absences comme des défauts noierait les vrais dans
 *     le bruit et rendrait le rapport inutile.
 */

export type GraviteAnomalie = 'BLOQUANTE' | 'AVERTISSEMENT';

export type CodeAnomalie =
  | 'OHLC_INCOHERENT'
  | 'PRIX_NON_POSITIF'
  | 'HORODATAGE_DUPLIQUE'
  | 'ORDRE_NON_CHRONOLOGIQUE'
  | 'HORODATAGE_DESALIGNE'
  | 'BOUGIE_FUTURE'
  | 'TROU'
  | 'SAUT_DE_PRIX'
  | 'VOLUME_NEGATIF';

export interface Anomalie {
  readonly code: CodeAnomalie;
  readonly gravite: GraviteAnomalie;
  /** Horodatage de la bougie fautive, ou de celle qui suit le trou. */
  readonly horodatage: number;
  readonly detail: string;
}

export interface RapportQualite {
  readonly bougies: number;
  readonly debut: number | null;
  readonly fin: number | null;
  readonly anomalies: readonly Anomalie[];
  /** Bougies attendues sur la période, séances fermées déduites. */
  readonly attendues: number;
  /** Part de la période effectivement couverte, entre 0 et 1. */
  readonly couverture: number;
  /** Faux dès qu'une anomalie bloquante est présente. */
  readonly exploitable: boolean;
}

/**
 * Au-delà de ce multiple de l'amplitude médiane, un écart entre deux clôtures
 * consécutives est signalé. Ce n'est pas une erreur en soi — un lundi matin
 * après un week-end chargé saute vraiment — mais c'est aussi la signature d'un
 * split non ajusté ou d'un recollage de deux sources. Avertissement, donc, et
 * pas rejet : c'est à la lecture du rapport de trancher.
 */
const SEUIL_SAUT = 12;

export interface OptionsQualite {
  readonly intervalle: Intervalle;
  readonly classeActif?: ClasseActif;
  /** Instant de référence : toute bougie postérieure est une anomalie. */
  readonly maintenant?: number;
}

export function verifierSerie(
  chandeliers: readonly Chandelier[],
  options: OptionsQualite,
): RapportQualite {
  const duree = dureeSecondes(options.intervalle);
  const maintenant = options.maintenant ?? Math.floor(Date.now() / 1000);
  const anomalies: Anomalie[] = [];

  if (chandeliers.length === 0) {
    return {
      bougies: 0,
      debut: null,
      fin: null,
      anomalies,
      attendues: 0,
      couverture: 0,
      exploitable: false,
    };
  }

  const amplitudeMediane = medianeAmplitude(chandeliers);

  for (let index = 0; index < chandeliers.length; index += 1) {
    const bougie = chandeliers[index]!;
    verifierBougie(bougie, duree, maintenant, anomalies);

    if (index === 0) continue;
    const precedente = chandeliers[index - 1]!;
    verifierEnchainement(precedente, bougie, duree, options, amplitudeMediane, anomalies);
  }

  const debut = chandeliers[0]!.horodatage;
  const fin = chandeliers[chandeliers.length - 1]!.horodatage;
  const attendues = bougiesAttendues(debut, fin, options);

  return {
    bougies: chandeliers.length,
    debut,
    fin,
    anomalies,
    attendues,
    couverture: attendues === 0 ? 1 : Math.min(1, chandeliers.length / attendues),
    exploitable: !anomalies.some((anomalie) => anomalie.gravite === 'BLOQUANTE'),
  };
}

function verifierBougie(
  bougie: Chandelier,
  duree: number,
  maintenant: number,
  anomalies: Anomalie[],
): void {
  const { horodatage, ouverture, haut, bas, cloture, volume } = bougie;

  if ([ouverture, haut, bas, cloture].some((prix) => !Number.isFinite(prix) || prix <= 0)) {
    anomalies.push({
      code: 'PRIX_NON_POSITIF',
      gravite: 'BLOQUANTE',
      horodatage,
      detail: `Prix inexploitable (O ${ouverture}, H ${haut}, B ${bas}, C ${cloture}).`,
    });
    return;
  }

  if (haut < Math.max(ouverture, cloture) || bas > Math.min(ouverture, cloture) || haut < bas) {
    anomalies.push({
      code: 'OHLC_INCOHERENT',
      gravite: 'BLOQUANTE',
      horodatage,
      detail: `Le haut (${haut}) et le bas (${bas}) n'encadrent pas l'ouverture (${ouverture}) et la clôture (${cloture}).`,
    });
  }

  if (horodatage % duree !== 0) {
    // Un décalage constant trahit presque toujours un fuseau mal interprété.
    anomalies.push({
      code: 'HORODATAGE_DESALIGNE',
      gravite: 'AVERTISSEMENT',
      horodatage,
      detail: `L'horodatage ne tombe pas sur une ouverture de bougie (reste ${horodatage % duree} s).`,
    });
  }

  if (horodatage > maintenant) {
    anomalies.push({
      code: 'BOUGIE_FUTURE',
      gravite: 'BLOQUANTE',
      horodatage,
      detail: 'Bougie postérieure à l’instant de référence.',
    });
  }

  if (volume !== null && volume < 0) {
    anomalies.push({
      code: 'VOLUME_NEGATIF',
      gravite: 'AVERTISSEMENT',
      horodatage,
      detail: `Volume négatif (${volume}).`,
    });
  }
}

function verifierEnchainement(
  precedente: Chandelier,
  bougie: Chandelier,
  duree: number,
  options: OptionsQualite,
  amplitudeMediane: number,
  anomalies: Anomalie[],
): void {
  const ecartTemps = bougie.horodatage - precedente.horodatage;

  if (ecartTemps === 0) {
    anomalies.push({
      code: 'HORODATAGE_DUPLIQUE',
      gravite: 'BLOQUANTE',
      horodatage: bougie.horodatage,
      detail: 'Deux bougies portent le même horodatage.',
    });
    return;
  }

  if (ecartTemps < 0) {
    anomalies.push({
      code: 'ORDRE_NON_CHRONOLOGIQUE',
      gravite: 'BLOQUANTE',
      horodatage: bougie.horodatage,
      detail: 'La série n’est pas triée par horodatage croissant.',
    });
    return;
  }

  if (ecartTemps > duree && !fermetureAttendue(precedente.horodatage, bougie.horodatage, options)) {
    const manquantes = Math.round(ecartTemps / duree) - 1;
    anomalies.push({
      code: 'TROU',
      gravite: 'AVERTISSEMENT',
      horodatage: bougie.horodatage,
      detail: `${manquantes} bougie${manquantes > 1 ? 's' : ''} manquante${manquantes > 1 ? 's' : ''} hors fermeture de marché.`,
    });
  }

  if (amplitudeMediane > 0) {
    const saut = Math.abs(bougie.ouverture - precedente.cloture);
    if (saut > amplitudeMediane * SEUIL_SAUT) {
      anomalies.push({
        code: 'SAUT_DE_PRIX',
        gravite: 'AVERTISSEMENT',
        horodatage: bougie.horodatage,
        detail:
          `Écart de ${saut.toPrecision(4)} entre la clôture précédente et l'ouverture, ` +
          `soit ${Math.round(saut / amplitudeMediane)} fois l'amplitude médiane. ` +
          'Split non ajusté, changement de source ou rupture réelle : à trancher à la lecture.',
      });
    }
  }
}

/**
 * Le trou correspond-il à une fermeture normale ?
 *
 * Traitement volontairement grossier : seul le week-end Forex est reconnu avec
 * certitude. Pour les actions et les indices, toute absence hors séance continue
 * est tolérée — la nuit et les jours fériés produiraient sinon des milliers de
 * faux positifs, et un rapport que personne ne lit ne protège de rien.
 */
function fermetureAttendue(debut: number, fin: number, options: OptionsQualite): boolean {
  if (options.classeActif === 'CRYPTO') return false; // cote en continu, un trou est un trou

  if (options.classeActif === 'ACTION' || options.classeActif === 'INDICE') return true;

  // FOREX, matières premières et cas non renseigné : le trou doit chevaucher
  // une plage de week-end pour être excusé.
  for (let instant = debut; instant < fin; instant += 3_600) {
    if (weekEndForex(instant)) return true;
  }
  return weekEndForex(fin);
}

function bougiesAttendues(debut: number, fin: number, options: OptionsQualite): number {
  const duree = dureeSecondes(options.intervalle);
  const total = Math.floor((fin - debut) / duree) + 1;
  if (options.classeActif === 'CRYPTO' || total <= 0) return Math.max(0, total);

  // Le Forex ne cote que cinq jours sur sept ; annoncer une couverture calculée
  // sur sept ferait passer une série complète pour lacunaire à 71 %.
  if (options.classeActif === 'ACTION' || options.classeActif === 'INDICE') {
    return Math.round(total * (5 / 7) * (7 / 24));
  }
  return Math.round(total * (5 / 7));
}

function medianeAmplitude(chandeliers: readonly Chandelier[]): number {
  const amplitudes = chandeliers
    .map((bougie) => bougie.haut - bougie.bas)
    .filter((valeur) => Number.isFinite(valeur) && valeur > 0)
    .sort((a, b) => a - b);

  if (amplitudes.length === 0) return 0;
  return amplitudes[Math.floor(amplitudes.length / 2)]!;
}

/** Résumé court, destiné au journal d'import et à l'interface. */
export function resumerQualite(rapport: RapportQualite): string {
  if (rapport.bougies === 0) return 'Aucune bougie.';

  const bloquantes = rapport.anomalies.filter((a) => a.gravite === 'BLOQUANTE').length;
  const avertissements = rapport.anomalies.length - bloquantes;
  const couverture = `${Math.round(rapport.couverture * 100)} % de couverture`;

  if (bloquantes > 0) {
    return `${rapport.bougies} bougies, ${couverture}, ${bloquantes} anomalie${bloquantes > 1 ? 's' : ''} bloquante${bloquantes > 1 ? 's' : ''} — série inexploitable.`;
  }
  if (avertissements > 0) {
    return `${rapport.bougies} bougies, ${couverture}, ${avertissements} avertissement${avertissements > 1 ? 's' : ''}.`;
  }
  return `${rapport.bougies} bougies, ${couverture}, aucune anomalie.`;
}
