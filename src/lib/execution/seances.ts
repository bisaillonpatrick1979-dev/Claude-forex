import type { Instrument } from './types';

/**
 * Horaires de séance.
 *
 * Le moteur refuse d'ouvrir une position hors séance : un backtest qui remplit
 * un ordre le dimanche produit des résultats que le marché réel n'aurait jamais
 * donnés. Les stops et take-profits, eux, restent évalués sur toute bougie
 * fournie — si la donnée existe, c'est que le marché cotait.
 */

function minutesDepuisMinuit(heure: string): number {
  const [h, m] = heure.split(':');
  return Number.parseInt(h ?? '0', 10) * 60 + Number.parseInt(m ?? '0', 10);
}

export function marcheOuvert(instrument: Instrument, horodatageSecondes: number): boolean {
  const plages = instrument.horairesSeance;
  // Aucun horaire déclaré : on considère le marché ouvert en continu plutôt
  // que fermé, sinon un instrument mal configuré bloquerait tout en silence.
  if (Object.keys(plages).length === 0) return true;

  const date = new Date(horodatageSecondes * 1000);
  const jour = String(date.getUTCDay());
  const plagesDuJour = plages[jour];
  if (!plagesDuJour || plagesDuJour.length === 0) return false;

  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return plagesDuJour.some(
    ([debut, fin]) => minutes >= minutesDepuisMinuit(debut) && minutes <= minutesDepuisMinuit(fin),
  );
}

/**
 * Un rollover a-t-il eu lieu entre deux instants ? Les frais de swap sont
 * facturés au passage de 22:00 UTC, convention de la plupart des courtiers.
 */
const HEURE_ROLLOVER_UTC = 22;

export function nombreRollovers(depuis: number, jusqua: number): number {
  if (jusqua <= depuis) return 0;

  let compte = 0;
  const premier = new Date(depuis * 1000);
  premier.setUTCHours(HEURE_ROLLOVER_UTC, 0, 0, 0);
  let borne = Math.floor(premier.getTime() / 1000);
  if (borne <= depuis) borne += 86400;

  while (borne <= jusqua) {
    compte += 1;
    borne += 86400;
  }

  return compte;
}
