/**
 * Surveillance des niveaux tracés — fonction Edge, appelée par pg_cron.
 *
 * Elle lit les alertes actives, interroge le fournisseur une fois par symbole,
 * et n'écrit un événement que sur un vrai changement de côté.
 *
 * ── Machine à trois états ───────────────────────────────────────────────────
 *
 *      prix > niveau + zone morte   →  dessus
 *      prix < niveau − zone morte   →  dessous
 *      entre les deux               →  dedans
 *
 * Un franchissement n'est reconnu que sur `dessous → dessus` ou l'inverse. Un
 * cours qui vibre sur le niveau reste `dedans` et ne notifie rien — ce qu'une
 * condition « prix >= niveau » ne sait pas produire. Le côté est mis à jour
 * même quand la direction surveillée ne correspond pas : filtrer les deux
 * ensemble désynchroniserait la machine, et une alerte haussière resterait
 * bloquée sur « dessus » sans jamais revoir de remontée.
 *
 * La logique est reproduite et testée dans `src/lib/alertes/evaluation.ts`.
 * Deno ne partage pas le graphe de modules de Next : c'est une duplication
 * assumée, et les tests du côté applicatif sont ce qui la tient honnête.
 *
 * ── Comptabilité du quota ───────────────────────────────────────────────────
 *
 * Chaque appel passe d'abord par `reserver_appel_fournisseur`, la même
 * réservation atomique que le reste de l'application. Sans elle, cette
 * fonction consommait le quota Twelve Data **en dehors** de toute
 * comptabilité : l'application se croyait à 220/800 pendant que le fournisseur
 * comptait bien plus, et les refus seraient tombés sur les graphiques et les
 * cycles sans qu'on puisse les rattacher à quoi que ce soit.
 *
 * L'arithmétique, à retenir avant de changer la cadence du cron : une minute
 * d'intervalle sur un seul symbole fait 1 440 appels par jour, contre 800
 * autorisés. Le palier gratuit est épuisé en treize heures — et la
 * réservation, elle, coupe avant.
 *
 * Secrets requis : TWELVE_DATA_API_KEY. SUPABASE_URL et
 * SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement.
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
  usage_unique: boolean;
}

const FOURNISSEUR = 'twelvedata';

/** De quel côté du niveau se trouve le prix, zone morte comprise. */
function determinerCote(prix: number, niveau: number, zoneMorte: number): Cote {
  const marge = Math.abs(zoneMorte);
  if (prix > niveau + marge) return 'dessus';
  if (prix < niveau - marge) return 'dessous';
  return 'dedans';
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

  const { data: alertes, error } = await supabase
    .from('alertes_prix')
    .select(
      'id, profil_id, symbole, annotation_id, libelle_annotation, niveau, zone_morte, direction, dernier_cote, usage_unique',
    )
    .eq('active', true);

  if (error) return json({ erreur: error.message }, 500);
  if (!alertes || alertes.length === 0) return json({ surveillees: 0, declenchees: 0 });

  // Un appel réseau par couple profil/symbole, quel que soit le nombre
  // d'alertes posées dessus. Le quota est la ressource rare, pas le calcul.
  const couples = new Map<string, { profilId: string; symbole: string }>();
  for (const alerte of alertes as Alerte[]) {
    couples.set(`${alerte.profil_id}|${alerte.symbole}`, {
      profilId: alerte.profil_id,
      symbole: alerte.symbole,
    });
  }

  const prixParCle = new Map<string, number>();
  const refus: string[] = [];

  for (const [cle, { profilId, symbole }] of couples) {
    const { data: reservation } = await supabase.rpc('reserver_appel_fournisseur', {
      p_profil_id: profilId,
      p_code: FOURNISSEUR,
      p_maintenant: new Date().toISOString(),
    });

    const autorise = Array.isArray(reservation) ? reservation[0]?.autorise : undefined;
    if (autorise !== true) {
      const raison = Array.isArray(reservation) ? reservation[0]?.raison : 'réservation refusée';
      refus.push(`${symbole} : ${raison ?? 'refus sans motif'}`);
      continue;
    }

    const prix = await recupererPrix(symbole, cleTwelveData);
    if (prix !== null) prixParCle.set(cle, prix);
  }

  const evenements: Record<string, unknown>[] = [];
  const misesAJour: { id: string; cote: Cote; prix: number; desactiver: boolean }[] = [];

  for (const alerte of alertes as Alerte[]) {
    const prix = prixParCle.get(`${alerte.profil_id}|${alerte.symbole}`);
    // Prix non obtenu — quota refusé ou fournisseur muet. On ne touche pas à
    // l'état : écrire un côté sans observation inventerait un mouvement et
    // pourrait faire manquer le franchissement suivant.
    if (prix === undefined) continue;

    const coteActuelle = determinerCote(prix, Number(alerte.niveau), Number(alerte.zone_morte));
    const cotePrecedente = alerte.dernier_cote;

    let sens: Sens | null = null;
    if (cotePrecedente === 'dessous' && coteActuelle === 'dessus') sens = 'haussier';
    if (cotePrecedente === 'dessus' && coteActuelle === 'dessous') sens = 'baissier';

    const retenu =
      sens !== null && (alerte.direction === 'les_deux' || alerte.direction === sens);

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

    misesAJour.push({
      id: alerte.id,
      cote: coteActuelle,
      prix,
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
        verifie_le: new Date().toISOString(),
        ...(maj.desactiver ? { active: false } : {}),
      })
      .eq('id', maj.id);
  }

  return json({
    surveillees: alertes.length,
    couples: couples.size,
    observes: prixParCle.size,
    refusQuota: refus,
    declenchees: evenements.length,
  });
});

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json' },
  });
}
