import type { Comparateur } from '@/lib/backtest/comparateurs';
import type { Metriques } from '@/lib/backtest/metriques';
import { STRATEGIES } from '@/lib/backtest/strategies';
import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { clientServeur } from '@/lib/supabase/serveur';

import { ConsoleBacktest, type OptionSymbole } from './console';
import { ImportHistorique } from './import';

export const metadata = { title: 'Backtest — Trading Floor IA' };

export default async function PageBacktest() {
  const supabase = await clientServeur();

  const [{ data: symboles }, { data: series }, { data: backtests }] = await Promise.all([
    supabase.from('symboles').select('id, code, libelle').eq('actif', true).order('code'),
    supabase.from('chandeliers').select('symbole_id, intervalle, horodatage, fournisseur_code'),
    supabase
      .from('backtests')
      .select(
        'id, symbole_id, intervalle, debut, fin, configuration, metriques, comparateurs, validation',
      )
      .order('cree_le', { ascending: false })
      .limit(10),
  ]);

  const codes = new Map((symboles ?? []).map((ligne) => [ligne.id, ligne.code]));
  const historique = resumerHistorique(series ?? [], codes);

  const options: OptionSymbole[] = (symboles ?? []).map((ligne) => ({
    code: ligne.code,
    libelle: `${ligne.code} — ${ligne.libelle}`,
  }));

  return (
    <>
      <EntetePage
        titre="Backtest"
        description="Rejeu historique sur le même moteur d’exécution que le papier — mêmes coûts, même barrière anti-look-ahead."
      />

      <div className="mb-3">
        <ConsoleBacktest symboles={options} historique={historique} />
      </div>

      <Panneau titre="Importer un historique" className="mb-3">
        <ImportHistorique symboles={options.map((option) => option.code)} />
        <p className="mt-3 text-xs leading-relaxed text-texte-attenue">
          Le palier gratuit d’un fournisseur ne donne pas quinze ans d’historique, et les bougies
          simulées ne donneront jamais de vrais mouvements. Un fichier téléchargé une fois — chez
          Twelve Data, chez un courtier, chez Dukascopy — apporte la profondeur nécessaire sans
          consommer un seul appel, et pour de bon.
        </p>
      </Panneau>

      {(backtests ?? []).length === 0 ? (
        <Panneau className="min-h-56">
          <EtatVide message="Aucun backtest lancé." />
          <p className="mx-auto mt-4 max-w-md text-center text-xs leading-relaxed text-texte-attenue">
            Chaque résultat est affiché à côté de deux références : achat-conservation sur le même
            instrument, et une stratégie aléatoire de même fréquence. Si la stratégie ne les bat
            pas, l’écran le dit.
          </p>
        </Panneau>
      ) : (
        <div className="flex flex-col gap-3">
          {(backtests ?? []).map((ligne) => (
            <CarteResultat
              key={ligne.id}
              symbole={codes.get(ligne.symbole_id) ?? '—'}
              intervalle={ligne.intervalle}
              debut={ligne.debut}
              fin={ligne.fin}
              configuration={(ligne.configuration ?? {}) as Record<string, unknown>}
              metriques={ligne.metriques as unknown as Metriques | null}
              comparateurs={ligne.comparateurs as unknown as Comparateur[] | null}
              validation={ligne.validation as unknown as BlocValidation | null}
            />
          ))}
        </div>
      )}
    </>
  );
}

function CarteResultat({
  symbole,
  intervalle,
  debut,
  fin,
  configuration,
  metriques,
  comparateurs,
  validation,
}: {
  symbole: string;
  intervalle: string;
  debut: string;
  fin: string;
  configuration: Record<string, unknown>;
  metriques: Metriques | null;
  comparateurs: readonly Comparateur[] | null;
  validation: BlocValidation | null;
}) {
  if (!metriques) return null;

  const codeStrategie = String(configuration.strategie ?? '');
  const nomStrategie =
    STRATEGIES.find((option) => option.code === codeStrategie)?.nom ?? codeStrategie;

  return (
    <Panneau>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-texte">
          {nomStrategie} · {symbole} {intervalle}
        </h3>
        <p className="chiffre text-xs text-texte-attenue">
          {debut.slice(0, 10)} → {fin.slice(0, 10)} · {String(configuration.bougies ?? '?')} bougies
        </p>
      </div>

      {validation?.walkForward ? (
        <div
          className={`mt-3 rounded border px-3 py-2 text-xs leading-relaxed ${
            validation.walkForward.significativite?.significatif
              ? 'border-hausse/40 bg-hausse/10 text-hausse'
              : 'border-alerte/40 bg-alerte/10 text-alerte'
          }`}
        >
          <p className="mb-1 font-medium uppercase tracking-wide">
            {validation.walkForward.significativite?.significatif
              ? 'Distinguable du hasard'
              : 'Ne se distingue pas du hasard'}
          </p>
          <p>{validation.walkForward.verdict}</p>
          {validation.monteCarlo ? <p className="mt-1">{validation.monteCarlo.verdict}</p> : null}
        </div>
      ) : (
        <p className="mt-3 rounded border border-bordure/60 px-3 py-2 text-xs text-texte-attenue">
          Historique trop court pour découper des fenêtres de validation : les chiffres ci-dessous
          décrivent une seule période et ne disent rien de leur reproductibilité.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Mesure etiquette="Rendement" valeur={pourcentage(metriques.rendementPct)} signe />
        <Mesure etiquette="Drawdown max" valeur={pourcentage(-metriques.drawdownMaxPct)} signe />
        <Mesure etiquette="Sharpe" valeur={nombre(metriques.sharpe)} />
        <Mesure etiquette="Trades" valeur={String(metriques.trades)} />
        <Mesure etiquette="Réussite" valeur={pourcentage(metriques.tauxReussitePct)} />
        <Mesure etiquette="Facteur profit" valeur={nombre(metriques.facteurProfit)} />
      </div>

      {validation?.walkForward ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mesure
            etiquette="Hors échantillon"
            valeur={pourcentage(validation.walkForward.horsEchantillon?.rendementPct)}
            signe
          />
          <Mesure
            etiquette="Dégradation"
            valeur={pourcentage(-Math.abs(validation.walkForward.degradation ?? 0))}
            signe
          />
          <Mesure
            etiquette="Fenêtres gagnantes"
            valeur={pourcentage((validation.walkForward.partFenetresGagnantes ?? 0) * 100)}
          />
          <Mesure
            etiquette="Drawdown 95e centile"
            valeur={pourcentage(-(validation.monteCarlo?.drawdownPercentile95 ?? 0))}
            signe
          />
        </div>
      ) : null}

      {comparateurs && comparateurs.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-texte-attenue">Références</p>
          <div className="flex flex-col gap-2">
            {comparateurs.map((comparateur) => {
              const battue = metriques.rendementPct > comparateur.metriques.rendementPct;
              return (
                <div
                  key={comparateur.code}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-bordure/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-texte">{comparateur.nom}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-texte-attenue">
                      {comparateur.explication}
                    </p>
                  </div>
                  <div className="flex items-baseline gap-3 whitespace-nowrap">
                    <span
                      className={`chiffre text-sm ${battue ? 'text-texte-attenue' : 'text-alerte'}`}
                    >
                      {pourcentage(comparateur.metriques.rendementPct)}
                    </span>
                    <span className="text-xs text-texte-attenue">
                      {battue ? 'battue' : 'non battue'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-texte-attenue">
        Ces chiffres décrivent une série passée. Ils ne prédisent rien : leur seul usage honnête est
        comparatif.
      </p>
    </Panneau>
  );
}

function Mesure({
  etiquette,
  valeur,
  signe = false,
}: {
  etiquette: string;
  valeur: string;
  signe?: boolean;
}) {
  const couleur =
    !signe || valeur === '—'
      ? 'text-texte'
      : valeur.startsWith('-')
        ? 'text-baisse'
        : 'text-hausse';

  return (
    <div>
      <p className="text-xs text-texte-attenue">{etiquette}</p>
      <p className={`chiffre text-sm ${couleur}`}>{valeur}</p>
    </div>
  );
}

function pourcentage(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return '—';
  return `${valeur >= 0 ? '+' : ''}${valeur.toFixed(1)} %`;
}

function nombre(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return '—';
  return valeur.toFixed(2);
}

/**
 * Ce qui est disponible en base, par couple instrument/intervalle.
 *
 * La source est affichée, et ce n'est pas un détail : savoir qu'on rejoue de
 * la simulation plutôt que du réel change tout ce qu'on peut conclure du
 * résultat. Un backtest brillant sur des bougies inventées ne dit rien du
 * marché, seulement du générateur.
 */
function resumerHistorique(
  series: readonly {
    symbole_id: string;
    intervalle: string;
    horodatage: string;
    fournisseur_code: string;
  }[],
  codes: ReadonlyMap<string, string>,
): Record<string, { bougies: number; source: string; debut: string }> {
  const resume: Record<string, { bougies: number; source: string; debut: string }> = {};

  for (const ligne of series) {
    const code = codes.get(ligne.symbole_id);
    if (!code) continue;

    const cle = `${code}|${ligne.intervalle}`;
    const jour = ligne.horodatage.slice(0, 10);
    const existant = resume[cle];

    if (!existant) {
      resume[cle] = { bougies: 1, source: ligne.fournisseur_code, debut: jour };
      continue;
    }
    existant.bougies += 1;
    if (jour < existant.debut) existant.debut = jour;
  }

  return resume;
}

/**
 * Bloc de validation tel qu'il est stocké. Volontairement permissif : c'est du
 * JSON en base, et une forme inattendue doit dégrader l'affichage plutôt que
 * casser la page.
 */
interface BlocValidation {
  readonly walkForward: {
    readonly fenetres?: number;
    readonly horsEchantillon?: Metriques;
    readonly enEchantillon?: Metriques;
    readonly degradation?: number;
    readonly partFenetresGagnantes?: number;
    readonly verdict?: string;
    readonly significativite?: { readonly significatif?: boolean } | null;
  } | null;
  readonly monteCarlo: {
    readonly drawdownPercentile95?: number;
    readonly verdict?: string;
  } | null;
}
