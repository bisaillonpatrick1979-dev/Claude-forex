/**
 * Où commence une journée de trading.
 *
 * La question n'est pas cosmétique. Trois plafonds se réarment « chaque
 * jour » — le budget d'appels aux modèles, le nombre de trades par agent, et
 * la perte journalière. Tant que la journée était celle de l'UTC, ces trois
 * compteurs se remettaient à zéro à 18 h heure de l'Alberta : en plein milieu
 * de la soirée, et surtout **pendant** la séance de New York, qui court jusqu'à
 * 14 h locales. Un plafond journalier qui se réarme au milieu de la journée de
 * travail n'est pas un plafond journalier.
 *
 * On raisonne donc dans le fuseau du propriétaire de la firme. Le fuseau est
 * stocké par profil plutôt que déduit du navigateur : les cycles tournent aussi
 * sans navigateur — depuis un cron —, et deux sources de vérité pour la même
 * question finiraient par donner deux réponses.
 *
 * Aucune dépendance : `Intl` sait déjà tout ça, y compris les règles d'heure
 * d'été passées et à venir. Une table de décalages écrite à la main serait
 * fausse au premier changement de législation.
 */

/** Faute de mieux, l'UTC : jamais d'exception, jamais de dérive silencieuse. */
export const FUSEAU_DEFAUT = 'UTC';

/**
 * Décalage du fuseau à un instant donné, en minutes (positif à l'est).
 *
 * Le procédé : formater l'instant dans le fuseau visé, relire le résultat comme
 * s'il s'agissait d'UTC, et prendre la différence. C'est la seule façon
 * d'obtenir un décalage exact sans embarquer une base de données de fuseaux —
 * et elle traite l'heure d'été gratuitement, puisque `Intl` l'applique.
 */
function decalageMinutes(fuseau: string, instant: Date): number {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const morceaux: Record<string, number> = {};
  for (const { type, value } of format.formatToParts(instant)) {
    if (type !== 'literal') morceaux[type] = Number(value);
  }

  // `hour12: false` peut rendre 24 pour minuit selon l'implémentation.
  const heure = morceaux.hour === 24 ? 0 : (morceaux.hour ?? 0);

  const commeUtc = Date.UTC(
    morceaux.year ?? 1970,
    (morceaux.month ?? 1) - 1,
    morceaux.day ?? 1,
    heure,
    morceaux.minute ?? 0,
    morceaux.second ?? 0,
  );

  return Math.round((commeUtc - instant.getTime()) / 60_000);
}

/** Un fuseau qu'`Intl` ne connaît pas lève une `RangeError` : on ne veut pas
 *  qu'une chaîne mal saisie en base fasse tomber un cycle entier. */
export function fuseauValide(fuseau: string | null | undefined): string {
  if (!fuseau) return FUSEAU_DEFAUT;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuseau }).format(new Date());
    return fuseau;
  } catch {
    return FUSEAU_DEFAUT;
  }
}

/** Date locale au format `AAAA-MM-JJ`, telle qu'attendue par une colonne `date`. */
export function jourLocal(fuseau: string, maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseauValide(fuseau),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(maintenant);
}

/**
 * Instant exact où a commencé la journée locale en cours.
 *
 * Deux passes, et ce n'est pas de la prudence excessive : le décalage utilisé
 * pour situer minuit est celui de **maintenant**, qui peut différer de celui
 * qui régnait à minuit — précisément les jours de changement d'heure. On
 * corrige donc avec le décalage recalculé à l'instant estimé.
 *
 * Cas limite assumé : là où minuit local n'existe pas (certains fuseaux
 * avancent l'heure à 00 h 00), la deuxième passe rend le premier instant
 * existant du jour. C'est le comportement voulu — un compteur journalier doit
 * se réarmer, pas disparaître. L'Alberta avance à 2 h, donc le cas ne s'y
 * présente jamais.
 */
export function debutJourneeLocale(fuseau: string, maintenant: Date = new Date()): Date {
  const zone = fuseauValide(fuseau);
  const [annee, mois, jour] = jourLocal(zone, maintenant).split('-').map(Number);

  const minuitNaif = Date.UTC(annee!, mois! - 1, jour!);
  const estimation = new Date(minuitNaif - decalageMinutes(zone, maintenant) * 60_000);
  return new Date(minuitNaif - decalageMinutes(zone, estimation) * 60_000);
}

/** Même chose, en ISO — la forme attendue par les filtres PostgREST. */
export function debutJourneeIso(fuseau: string, maintenant: Date = new Date()): string {
  return debutJourneeLocale(fuseau, maintenant).toISOString();
}

/**
 * Libellé du décalage, pour l'afficher plutôt que de le laisser deviner.
 *
 * « journée UTC » était honnête tant que c'était vrai. Maintenant que la
 * journée est locale, l'écran doit dire laquelle — sans quoi un compteur à zéro
 * en fin de matinée reste inexplicable.
 */
export function libelleFuseau(fuseau: string, maintenant: Date = new Date()): string {
  const zone = fuseauValide(fuseau);
  const minutes = decalageMinutes(zone, maintenant);
  const signe = minutes < 0 ? '−' : '+';
  const absolu = Math.abs(minutes);
  const heures = String(Math.floor(absolu / 60)).padStart(2, '0');
  const reste = String(absolu % 60).padStart(2, '0');

  const nom =
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(maintenant)
      .find((morceau) => morceau.type === 'timeZoneName')?.value ?? zone;

  return `${zone} (${nom}, UTC${signe}${heures}:${reste})`;
}
