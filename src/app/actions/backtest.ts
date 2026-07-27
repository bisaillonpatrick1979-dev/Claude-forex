'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { calculerComparateurs, verdict } from '@/lib/backtest/comparateurs';
import { calculerMetriques } from '@/lib/backtest/metriques';
import { executerBacktest } from '@/lib/backtest/moteur';
import {
  STRATEGIES,
  decideurStrategie,
  fixerHorizonStrategies,
  type CodeStrategie,
} from '@/lib/backtest/strategies';
import { estHorizon } from '@/lib/agents/horizons';
import { chargerInstrument } from '@/lib/execution/persistance';
import { importerHistorique } from '@/lib/marche/import-historique';
import { estIntervalle } from '@/lib/marche/intervalles';
import { resumerQualite, verifierSerie } from '@/lib/marche/qualite';
import type { Chandelier, Intervalle } from '@/lib/marche/types';
import { limiterDebit } from '@/lib/securite/limitation-debit';
import { clientAdminOptionnel } from '@/lib/supabase/admin';
import { profilAuthentifie } from '@/lib/supabase/session';

/**
 * Lancement d'un backtest sur l'historique déjà en base.
 *
 * L'import et le backtest sont deux gestes séparés, et c'est délibéré. Importer
 * dépense du quota chez le fournisseur ; rejouer ne dépense rien. Les réunir
 * ferait payer une requête réseau à chaque essai de paramètre, alors que la
 * même série peut être rejouée cent fois pour rien.
 *
 * Le backtest ne lit que ce qui est en base : si l'historique est court, le
 * résultat le dit au lieu d'aller chercher discrètement de quoi le compléter.
 */

const MINIMUM_BOUGIES = 120;
const MAXIMUM_BOUGIES = 20_000;

export interface ResultatLancement {
  readonly ok: boolean;
  readonly message: string;
  readonly backtestId?: string;
}

const schema = z.object({
  symbole: z.string().min(1).max(20),
  intervalle: z.string().refine(estIntervalle, 'Intervalle inconnu.'),
  horizon: z.string().refine(estHorizon, 'Horizon inconnu.'),
  strategie: z
    .string()
    .refine(
      (valeur): valeur is CodeStrategie =>
        STRATEGIES.some((strategie) => strategie.code === valeur),
      'Stratégie inconnue.',
    ),
  capitalInitial: z.coerce.number().positive().max(10_000_000),
});

export async function lancerBacktest(
  symbole: string,
  intervalle: string,
  strategie: string,
  capitalInitial: number,
  horizon: string,
): Promise<ResultatLancement> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  if (!limiterDebit(`backtest:${profilId}`, 10, 60_000).autorise) {
    return { ok: false, message: 'Trop de backtests lancés, réessaie dans une minute.' };
  }

  const analyse = schema.safeParse({ symbole, intervalle, strategie, capitalInitial, horizon });
  if (!analyse.success) {
    return { ok: false, message: analyse.error.issues[0]?.message ?? 'Entrée invalide.' };
  }

  const client = clientAdminOptionnel();
  if (!client) {
    return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY absente côté serveur.' };
  }

  const instrument = await chargerInstrument(client, analyse.data.symbole);
  if (!instrument) {
    return { ok: false, message: `Instrument ${analyse.data.symbole} inconnu.` };
  }

  const chandeliers = await lireHistorique(
    client,
    instrument.symboleId,
    analyse.data.intervalle as Intervalle,
  );

  if (chandeliers.length < MINIMUM_BOUGIES) {
    return {
      ok: false,
      message:
        `Seulement ${chandeliers.length} bougies en base pour ${analyse.data.symbole} en ` +
        `${analyse.data.intervalle}. Il en faut au moins ${MINIMUM_BOUGIES} : importe d'abord ` +
        'l’historique depuis cet écran.',
    };
  }

  // Le contrôle qualité passe avant le rejeu. Un backtest sur une série
  // corrompue rend des chiffres parfaitement formés et parfaitement faux.
  const qualite = verifierSerie(chandeliers, {
    intervalle: analyse.data.intervalle as Intervalle,
    classeActif: instrument.instrument.classeActif,
  });
  if (!qualite.exploitable) {
    return {
      ok: false,
      message: `Série inexploitable : ${resumerQualite(qualite)} Réimporte avant de rejouer.`,
    };
  }

  const base = {
    chandeliers,
    instrument: instrument.instrument,
    intervalle: analyse.data.intervalle as Intervalle,
    capitalInitial: analyse.data.capitalInitial,
  };

  // Le stop et la cible viennent de l'horizon : c'est lui qui décide comment le
  // même signal se joue, et donc si les frais laissent quelque chose.
  fixerHorizonStrategies(analyse.data.horizon);

  const resultat = executerBacktest({
    ...base,
    decideur: decideurStrategie(analyse.data.strategie),
  });
  const metriques = calculerMetriques(resultat.courbeEquite, resultat.trades, base.intervalle);

  const comparateurs = calculerComparateurs({
    base,
    quantite: tailleMedianeOuDefaut(resultat.trades.map((trade) => trade.quantite)),
    tradesReference: Math.max(1, resultat.trades.length),
  });

  const { data, error } = await client
    .from('backtests')
    .insert({
      profil_id: profilId,
      symbole_id: instrument.symboleId,
      intervalle: base.intervalle,
      debut: new Date(chandeliers[0]!.horodatage * 1000).toISOString(),
      fin: new Date(chandeliers[chandeliers.length - 1]!.horodatage * 1000).toISOString(),
      capital_initial: analyse.data.capitalInitial,
      configuration: {
        strategie: analyse.data.strategie,
        horizon: analyse.data.horizon,
        bougies: chandeliers.length,
        qualite: { couverture: qualite.couverture, anomalies: qualite.anomalies.length },
      },
      statut: 'TERMINE',
      metriques: JSON.parse(JSON.stringify(metriques)),
      comparateurs: JSON.parse(JSON.stringify(comparateurs)),
      // La courbe est échantillonnée : trois cents points suffisent à la
      // dessiner, et vingt mille alourdiraient chaque chargement de page.
      courbe_equite: JSON.parse(JSON.stringify(echantillonner(resultat.courbeEquite, 300))),
      termine_le: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, message: error.message };

  await client.from('journal_audit').insert({
    profil_id: profilId,
    acteur: 'utilisateur',
    action: 'BACKTEST_LANCE',
    entite: 'backtests',
    entite_id: data?.id ?? null,
    details: {
      symbole: analyse.data.symbole,
      intervalle: base.intervalle,
      strategie: analyse.data.strategie,
      trades: metriques.trades,
    },
  });

  revalidatePath('/backtest');
  return {
    ok: true,
    backtestId: data?.id,
    message: verdict(metriques, comparateurs),
  };
}

/** Import d'historique déclenché depuis l'écran de backtest. */
export async function importerPourBacktest(
  symbole: string,
  intervalle: string,
  annees: number,
): Promise<ResultatLancement> {
  const profilId = await profilAuthentifie();
  if (!profilId) return { ok: false, message: 'Session expirée.' };

  if (!limiterDebit(`import:${profilId}`, 5, 300_000).autorise) {
    return {
      ok: false,
      message: 'Import déjà lancé récemment. Chaque import dépense du quota : attends cinq minutes.',
    };
  }
  if (!estIntervalle(intervalle)) return { ok: false, message: 'Intervalle inconnu.' };

  const client = clientAdminOptionnel();
  if (!client) {
    return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY absente côté serveur.' };
  }

  const profondeur = Math.min(Math.max(annees, 1), 15);
  const rapport = await importerHistorique({
    client,
    profilId,
    symbole,
    intervalle,
    depuis: Math.floor(Date.now() / 1000) - profondeur * 365 * 86_400,
    appelsMax: 40,
  });

  revalidatePath('/backtest');
  return { ok: rapport.ok, message: rapport.message };
}

async function lireHistorique(
  client: NonNullable<ReturnType<typeof clientAdminOptionnel>>,
  symboleId: string,
  intervalle: Intervalle,
): Promise<Chandelier[]> {
  const { data } = await client
    .from('chandeliers')
    .select('horodatage, ouverture, haut, bas, cloture, volume, fournisseur_code')
    .eq('symbole_id', symboleId)
    .eq('intervalle', intervalle)
    .order('horodatage', { ascending: false })
    .limit(MAXIMUM_BOUGIES);

  const lignes = data ?? [];
  if (lignes.length === 0) return [];

  // Même règle qu'à la lecture du cache : une série de backtest ne mélange pas
  // le simulé et le réel. Ici on va plus loin en s'en tenant à une source
  // unique — deux fournisseurs réels divergent assez pour brouiller une mesure
  // de performance sur dix ans.
  const source = lignes[0]!.fournisseur_code;

  return lignes
    .filter((ligne) => ligne.fournisseur_code === source)
    .map((ligne) => ({
      horodatage: Math.floor(new Date(ligne.horodatage).getTime() / 1000),
      ouverture: Number(ligne.ouverture),
      haut: Number(ligne.haut),
      bas: Number(ligne.bas),
      cloture: Number(ligne.cloture),
      volume: ligne.volume === null ? null : Number(ligne.volume),
    }))
    .sort((a, b) => a.horodatage - b.horodatage);
}

/** Taille de référence des comparateurs : celle que la stratégie a réellement
 *  prise. Les faire trader plus gros ou plus petit fausserait la comparaison. */
function tailleMedianeOuDefaut(quantites: readonly number[]): number {
  if (quantites.length === 0) return 0.1;
  const triees = [...quantites].sort((a, b) => a - b);
  return triees[Math.floor(triees.length / 2)] ?? 0.1;
}

function echantillonner<T>(points: readonly T[], maximum: number): T[] {
  if (points.length <= maximum) return [...points];
  const pas = points.length / maximum;
  const echantillon: T[] = [];
  for (let index = 0; index < maximum; index += 1) {
    echantillon.push(points[Math.floor(index * pas)]!);
  }
  const dernier = points[points.length - 1]!;
  if (echantillon[echantillon.length - 1] !== dernier) echantillon.push(dernier);
  return echantillon;
}
