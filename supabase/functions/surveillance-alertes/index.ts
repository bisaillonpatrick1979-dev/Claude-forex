/**
 * Surveillance des niveaux tracés — fonction Edge, appelée par pg_cron.
 *
 * Le cron tourne à la minute. Ce n'est **pas** la fréquence d'appel au
 * fournisseur : la fonction décide elle-même, symbole par symbole, s'il vaut la
 * peine de dépenser une requête. Le cron ne fait qu'ouvrir la porte.
 *
 * ── Machine à trois états ───────────────────────────────────────────────────
 *
 *      prix > niveau + zone morte   →  dessus
 *      prix < niveau − zone morte   →  dessous
 *      entre les deux               →  dedans
 *
 * Un franchissement n'est reconnu que sur `dessous → dessus` ou l'inverse. Un
 * cours qui vibre sur le niveau reste `dedans` et ne notifie rien. Le côté est
 * mis à jour même quand la direction surveillée ne correspond pas : filtrer les
 * deux ensemble désynchroniserait la machine, et une alerte haussière resterait
 * bloquée sur « dessus » sans jamais revoir de remontée.
 *
 * ── Cadence adaptative ──────────────────────────────────────────────────────
 *
 * Une cadence fixe se trompe dans les deux sens à la fois : trop souvent quand
 * le cours est hors de portée du niveau, trop rare quand il est collé dessus.
 * On estime donc le temps de parcours et on observe quatre fois avant l'arrivée
 * possible :
 *
 *     minutes pour atteindre ≈ distance / mouvement typique par minute
 *     intervalle             = minutes ÷ 4,  borné [1 min, 30 min]
 *
 * La volatilité est mesurée sur les observations elles-mêmes, lissée par
 * moyenne exponentielle. Ce n'est pas une prédiction de direction — seulement
 * une vitesse habituelle, et la marge de quatre absorbe l'erreur.
 *
 * Résultat : 48 appels par jour sur un cours qui dérive loin de tout niveau,
 * jusqu'à 1 440 sur un cours qui teste une résistance. La cadence fixe à cinq
 * minutes en coûtait 288 quoi qu'il arrive — et manquait quand même le test.
 *
 * ── Comptabilité du quota ───────────────────────────────────────────────────
 *
 * Chaque appel passe par `reserver_appel_fournisseur`, la même réservation
 * atomique que le reste de l'application. La cadence rend le refus rare ; c'est
 * la réservation qui garantit.
 *
 * La logique est reproduite et testée dans `src/lib/alertes/`. Deno ne partage
 * pas le graphe de modules de Next : duplication assumée, tenue honnête par les
 * tests du côté applicatif.
 *
 * Secrets requis : TWELVE_DATA_API_KEY.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Cote = 'dessus' | 'dessous' | 'dedans';
type Sens = 'haussier' | 'baissier';

interface Alerte {
  id: string;
  profil_id: string;
  symbole: string;
  annotation_id: string | null;
  libelle_annotation: string | null;
  niveau: number;
  zone_morte: number;
  direction: Sens | 'les_deux';
  dernier_cote: Cote | null;
  dernier_prix: number | null;
  verifie_le: string | null;
  volatilite_minute: number | null;
  prochaine_observation_le: string | null;
  usage_unique: boolean;
}

const FOURNISSEUR = 'twelvedata';
const INTERVALLE_MINIMUM_S = 60;
const INTERVALLE_MAXIMUM_S = 1800;
const MARGE_OBSERVATIONS = 4;
/** Poids de la nouvelle mesure dans le lissage de la volatilité. */
const LISSAGE = 0.3;

function determinerCote(prix: number, niveau: number, zoneMorte: number): Cote {
  const marge = Math.abs(zoneMorte);
  if (prix > niveau + marge) return 'dessus';
  if (prix < niveau - marge) return 'dessous';
  return 'dedans';
}

function intervalleObservation(distance: number, volatiliteParMinute: number): number {
  const ecart = Math.abs(distance);
  if (!Number.isFinite(ecart) || !Number.isFinite(volatiliteParMinute) || volatiliteParMinute <= 0) {
    return INTERVALLE_MAXIMUM_S;
  }
  const secondes = ((ecart / volatiliteParMinute) * 60) / MARGE_OBSERVATIONS;
  if (!Number.isFinite(secondes)) return INTERVALLE_MAXIMUM_S;
  return Math.min(INTERVALLE_MAXIMUM_S, Math.max(INTERVALLE_MINIMUM_S, Math.round(secondes)));
}

async function recupererPrix(symbole: string, cle: string): Promise<number | null> {
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbole)}&apikey=${cle}`;

  try {
    const reponse = await fetch(url);
    if (!reponse.ok) {
      console.error(`Twelve Data a répondu ${reponse.status} pour ${symbole}`);
      return null;
    }
    const donnees = await reponse.json();

    // Un quota dépassé revient en HTTP 200 avec un champ `code` : sans ce test
    // on lirait `undefined` comme un prix.
    if (donnees.code && donnees.code !== 200) {
      console.error(`Twelve Data ${symbole} : ${donnees.message ?? donnees.code}`);
      return null;
    }

    const prix = Number.parseFloat(donnees.price);
    return Number.isFinite(prix) ? prix : null;
  } catch (erreur) {
    console.error(`Échec réseau pour ${symbole}`, erreur);
    return null;
  }
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const cleTwelveData = Deno.env.get('TWELVE_DATA_API_KEY');

  if (!cleTwelveData) {
    return json({ erreur: 'TWELVE_DATA_API_KEY absente des secrets de la fonction.' }, 500);
  }

  const maintenant = new Date();

  const { data: alertes, error } = await supabase
    .from('alertes_prix')
    .select(
      'id, profil_id, symbole, annotation_id, libelle_annotation, niveau, zone_morte, direction, dernier_cote, dernier_prix, verifie_le, volatilite_minute, prochaine_observation_le, usage_unique',
    )
    .eq('active', true);

  if (error) return json({ erreur: error.message }, 500);
  if (!alertes || alertes.length === 0) return json({ surveillees: 0, declenchees: 0 });

  const toutes = alertes as Alerte[];

  // Une alerte est « due » quand son échéance est passée. Le symbole entier est
  // observé dès qu'une seule de ses alertes est due : le prix est le même pour
  // toutes, autant en faire profiter les autres puisque l'appel est payé.
  const symbolesDus = new Set<string>();
  for (const alerte of toutes) {
    const echeance = alerte.prochaine_observation_le;
    if (!echeance || new Date(echeance) <= maintenant) {
      symbolesDus.add(`${alerte.profil_id}|${alerte.symbole}`);
    }
  }

  if (symbolesDus.size === 0) {
    return json({ surveillees: toutes.length, observes: 0, declenchees: 0, motif: 'aucune échéance' });
  }

  const prixParCle = new Map<string, number>();
  const refus: string[] = [];

  for (const cle of symbolesDus) {
    const [profilId, symbole] = cle.split('|');

    const { data: reservation } = await supabase.rpc('reserver_appel_fournisseur', {
      p_profil_id: profilId,
      p_code: FOURNISSEUR,
      p_maintenant: maintenant.toISOString(),
    });

    const autorise = Array.isArray(reservation) ? reservation[0]?.autorise : undefined;
    if (autorise !== true) {
      const raison = Array.isArray(reservation) ? reservation[0]?.raison : 'réservation refusée';
      refus.push(`${symbole} : ${raison ?? 'refus sans motif'}`);
      continue;
    }

    const prix = await recupererPrix(symbole!, cleTwelveData);
    if (prix !== null) prixParCle.set(cle, prix);
  }

  // Distance au niveau armé le plus proche, par symbole : c'est elle qui fixe
  // la cadence, et elle se calcule sur l'ensemble des alertes du symbole.
  const niveauxParCle = new Map<string, number[]>();
  for (const alerte of toutes) {
    const cle = `${alerte.profil_id}|${alerte.symbole}`;
    const liste = niveauxParCle.get(cle) ?? [];
    liste.push(Number(alerte.niveau));
    niveauxParCle.set(cle, liste);
  }

  const evenements: Record<string, unknown>[] = [];
  const misesAJour: {
    id: string;
    cote: Cote;
    prix: number;
    volatilite: number;
    prochaine: string;
    desactiver: boolean;
  }[] = [];

  for (const alerte of toutes) {
    const cle = `${alerte.profil_id}|${alerte.symbole}`;
    const prix = prixParCle.get(cle);
    // Prix non obtenu — pas dû, quota refusé, ou fournisseur muet. On ne touche
    // pas à l'état : écrire un côté sans observation inventerait un mouvement.
    if (prix === undefined) continue;

    const coteActuelle = determinerCote(prix, Number(alerte.niveau), Number(alerte.zone_morte));
    const cotePrecedente = alerte.dernier_cote;

    let sens: Sens | null = null;
    if (cotePrecedente === 'dessous' && coteActuelle === 'dessus') sens = 'haussier';
    if (cotePrecedente === 'dessus' && coteActuelle === 'dessous') sens = 'baissier';

    const retenu = sens !== null && (alerte.direction === 'les_deux' || alerte.direction === sens);

    if (retenu && sens) {
      evenements.push({
        alerte_id: alerte.id,
        profil_id: alerte.profil_id,
        symbole: alerte.symbole,
        annotation_id: alerte.annotation_id,
        libelle_annotation: alerte.libelle_annotation,
        niveau: alerte.niveau,
        prix,
        direction: sens,
      });
    }

    // Volatilité observée : mouvement depuis la dernière mesure, ramené à la
    // minute, lissé. Une seule observation ne fait pas une volatilité — d'où le
    // repli sur la mesure brute au premier passage.
    const volatilite = majVolatilite(alerte, prix, maintenant);

    const niveaux = niveauxParCle.get(cle) ?? [];
    const distance = niveaux.reduce(
      (meilleure, niveau) => Math.min(meilleure, Math.abs(prix - niveau)),
      Number.POSITIVE_INFINITY,
    );

    const attente = intervalleObservation(distance, volatilite);

    misesAJour.push({
      id: alerte.id,
      cote: coteActuelle,
      prix,
      volatilite,
      prochaine: new Date(maintenant.getTime() + attente * 1000).toISOString(),
      desactiver: Boolean(retenu && alerte.usage_unique),
    });
  }

  if (evenements.length > 0) {
    const { error: erreurInsertion } = await supabase.from('evenements_alerte').insert(evenements);
    if (erreurInsertion) console.error('Insertion des événements', erreurInsertion.message);
  }

  for (const maj of misesAJour) {
    await supabase
      .from('alertes_prix')
      .update({
        dernier_cote: maj.cote,
        dernier_prix: maj.prix,
        volatilite_minute: maj.volatilite,
        prochaine_observation_le: maj.prochaine,
        verifie_le: maintenant.toISOString(),
        ...(maj.desactiver ? { active: false } : {}),
      })
      .eq('id', maj.id);
  }

  return json({
    surveillees: toutes.length,
    dus: symbolesDus.size,
    observes: prixParCle.size,
    refusQuota: refus,
    declenchees: evenements.length,
  });
});

function majVolatilite(alerte: Alerte, prix: number, maintenant: Date): number {
  const precedente = alerte.volatilite_minute === null ? null : Number(alerte.volatilite_minute);

  if (alerte.dernier_prix === null || alerte.verifie_le === null) {
    return precedente ?? 0;
  }

  const minutes = (maintenant.getTime() - new Date(alerte.verifie_le).getTime()) / 60_000;
  // Sous la seconde, le rapport explose et rendrait une volatilité absurde.
  if (!Number.isFinite(minutes) || minutes < 1 / 60) return precedente ?? 0;

  const mesure = Math.abs(prix - Number(alerte.dernier_prix)) / minutes;
  if (!Number.isFinite(mesure)) return precedente ?? 0;

  return precedente === null || precedente <= 0
    ? mesure
    : precedente * (1 - LISSAGE) + mesure * LISSAGE;
}

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json' },
  });
}
