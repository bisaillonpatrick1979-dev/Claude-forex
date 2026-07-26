import { tauxConversion } from '@/lib/execution/couts';
import { chargerInstrument } from '@/lib/execution/persistance';
import { SIMULATION_DEFAUT, type ContexteBougie } from '@/lib/execution/types';
import { atr, derniereValeur } from '@/lib/marche/indicateurs';
import { obtenirChandeliers } from '@/lib/marche/routeur';
import type { Chandelier, Intervalle } from '@/lib/marche/types';
import type { ParametresRisque } from '@/lib/risque/garde-fous';
import type { clientAdminOptionnel } from '@/lib/supabase/admin';

/**
 * Assemblage du contexte serveur partagé par tous les chemins d'exécution :
 * ordre manuel, proposition d'agent, validation d'une proposition en attente.
 *
 * Il vit ici plutôt que dans un fichier d'actions parce qu'un module
 * `'use server'` ne peut exporter que des fonctions asynchrones appelables par
 * le client — y loger des utilitaires partagés reviendrait à les exposer.
 */

export type ClientAdmin = NonNullable<ReturnType<typeof clientAdminOptionnel>>;

export type ContexteMarche =
  | {
      readonly ok: true;
      readonly chandeliers: readonly Chandelier[];
      readonly contexte: ContexteBougie;
      readonly symboleId: string;
    }
  | { readonly ok: false; readonly message: string };

export async function contexteDepuisMarche(
  client: ClientAdmin,
  profilId: string,
  symbole: string,
  intervalle: Intervalle,
): Promise<ContexteMarche> {
  const instrument = await chargerInstrument(client, symbole);
  if (!instrument) return { ok: false, message: `Instrument ${symbole} inconnu.` };

  const marche = await obtenirChandeliers({
    client,
    profilId,
    symbole,
    intervalle,
    limite: 200,
  });

  const derniere = marche.chandeliers[marche.chandeliers.length - 1];
  if (!derniere) return { ok: false, message: 'Aucune bougie disponible.' };

  const taux = tauxConversion(instrument.instrument, derniere.cloture, 'USD');

  return {
    ok: true,
    chandeliers: marche.chandeliers,
    symboleId: instrument.symboleId,
    contexte: {
      instrument: instrument.instrument,
      intervalle,
      bougie: derniere,
      atr: derniereValeur(atr(marche.chandeliers, 14)),
      tauxCotationVersCompte: taux,
      parametres: SIMULATION_DEFAUT,
    },
  };
}

export async function lireParametresRisque(
  client: ClientAdmin,
  profilId: string,
): Promise<ParametresRisque | null> {
  const { data } = await client
    .from('parametres_risque')
    .select('*')
    .eq('profil_id', profilId)
    .maybeSingle();

  if (!data) return null;

  return {
    risqueMaxParTradePct: Number(data.risque_max_par_trade_pct),
    risqueTotalMaxPct: Number(data.risque_total_max_pct),
    positionsMax: data.positions_max,
    positionsCorreleesMax: data.positions_correlees_max,
    seuilCorrelation: Number(data.seuil_correlation),
    perteJournaliereMaxPct: Number(data.perte_journaliere_max_pct),
    drawdownMaxPct: Number(data.drawdown_max_pct),
    levierMax: Number(data.levier_max),
    fenetreEvenementMacroMinutes: data.fenetre_evenement_macro_minutes,
    stopLossObligatoire: data.stop_loss_obligatoire,
  };
}
