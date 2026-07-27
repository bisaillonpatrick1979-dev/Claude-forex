import Link from 'next/link';

import { EntetePage } from '@/composants/ui/entete-page';
import { EtatVide, Panneau } from '@/composants/ui/panneau';
import { evaluerViabilite, HORIZONS } from '@/lib/agents/horizons';
import { tauxConversion } from '@/lib/execution/couts';
import type { Instrument } from '@/lib/execution/types';

import { ChoixHorizon, type ViabiliteAffichee } from './horizon';
import { formaterNombre } from '@/lib/format';
import { clientServeur } from '@/lib/supabase/serveur';

import { Reinitialisation } from './reinitialisation';

export const metadata = { title: 'Réglages — Trading Floor IA' };

export default async function PageReglages() {
  const supabase = await clientServeur();

  const [
    { data: fournisseurs },
    { data: risque },
    { data: portefeuille },
    { count: nombreLecons },
    { count: nombreCycles },
  ] = await Promise.all([
    supabase
      .from('fournisseurs_donnees')
      .select('id, code, nom, actif, quota_limite, quota_utilise, fenetre_quota, dernier_statut, derniere_erreur')
      .order('code'),
    supabase
      .from('parametres_risque')
      .select(
        'risque_max_par_trade_pct, risque_total_max_pct, positions_max, positions_correlees_max, perte_journaliere_max_pct, drawdown_max_pct, levier_max, fenetre_evenement_macro_minutes, stop_loss_obligatoire',
      )
      .maybeSingle(),
    supabase
      .from('portefeuilles')
      .select('capital_initial, devise')
      .limit(1)
      .maybeSingle(),
    supabase.from('lecons').select('id', { count: 'exact', head: true }),
    supabase.from('cycles').select('id', { count: 'exact', head: true }),
  ]);

  const { data: profil } = await supabase
    .from('profils')
    .select('horizon_trading')
    .limit(1)
    .maybeSingle();

  // La viabilité se calcule instrument par instrument : c'est la seule façon
  // de rendre le choix d'horizon éclairé plutôt que déclaratif.
  const { data: instruments } = await supabase
    .from('symboles')
    .select(
      'code, classe_actif, devise_base, devise_cotation, taille_contrat, pas_cotation, decimales, spread_defaut_points, commission_par_unite, swap_long_points, swap_court_points, levier_max, horaires_seance',
    )
    .eq('actif', true)
    .order('code');

  const devise = portefeuille?.devise ?? 'USD';
  const viabilites: Record<string, ViabiliteAffichee[]> = {};

  for (const horizon of HORIZONS) {
    viabilites[horizon] = (instruments ?? []).flatMap((ligne) => {
      const instrument = versInstrument(ligne);
      // ATR supposé : un pour mille du prix de référence. Grossier mais
      // suffisant pour classer les instruments entre eux — et annoncé comme
      // tel plutôt que présenté comme une mesure.
      const prixReference = ligne.pas_cotation * 100_000;
      const atr = prixReference > 0 ? prixReference * 0.001 : null;
      const taux = tauxConversion(instrument, prixReference, devise);
      if (taux === null) return [];

      const verdict = evaluerViabilite(horizon, instrument, atr, taux);
      return [
        {
          symbole: ligne.code,
          viable: verdict.viable,
          partCoutsPct: Math.round(verdict.partCouts * 100),
          explication: verdict.explication,
        },
      ];
    });
  }

  return (
    <>
      <EntetePage
        titre="Réglages"
        description="Fournisseurs de données, clés API, modèles LLM et limites de risque."
      />

      <Panneau titre="Horizon de trading">
        <ChoixHorizon
          actif={profil?.horizon_trading ?? 'INTRADAY'}
          viabilites={viabilites}
        />
        <p className="mt-3 text-xs leading-relaxed text-texte-attenue">
          Les agents connaissent les quatre horizons ; celui-ci décide lequel ils appliquent, et
          quels playbooks leur sont servis. Un instrument barré est un instrument où les frais
          d’aller-retour mangent le mouvement visé — aucune analyse ne rattrape cette arithmétique.
        </p>
      </Panneau>

      <Panneau titre="Capital et réinitialisation">
        <Reinitialisation
          capitalActuel={Number(portefeuille?.capital_initial ?? 0)}
          devise={portefeuille?.devise ?? 'USD'}
          nombreLecons={nombreLecons ?? 0}
          nombreCycles={nombreCycles ?? 0}
        />
      </Panneau>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panneau
          titre="Fournisseurs de données"
          action={
            <Link
              href="/reglages/fournisseurs"
              className="text-xs text-accent underline-offset-4 hover:underline"
            >
              Configurer
            </Link>
          }
        >
          {!fournisseurs || fournisseurs.length === 0 ? (
            <EtatVide message="Aucun fournisseur configuré." />
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-texte-attenue">
                <tr>
                  <th className="pb-2 font-medium">Fournisseur</th>
                  <th className="pb-2 font-medium">État</th>
                  <th className="pb-2 text-right font-medium">Quota</th>
                </tr>
              </thead>
              <tbody>
                {fournisseurs.map((fournisseur) => (
                  <tr key={fournisseur.id} className="border-t border-bordure/60">
                    <td className="py-1.5">
                      <span className="text-texte">{fournisseur.nom}</span>
                      <span className="chiffre ml-1.5 text-texte-attenue">{fournisseur.code}</span>
                    </td>
                    <td className="chiffre py-1.5 text-texte-attenue">
                      {fournisseur.actif ? 'actif' : 'inactif'}
                    </td>
                    <td className="chiffre py-1.5 text-right text-texte-attenue">
                      {fournisseur.quota_limite === null
                        ? 'illimité'
                        : `${fournisseur.quota_utilise} / ${fournisseur.quota_limite} · ${fournisseur.fenetre_quota.toLowerCase()}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-texte-attenue">
            Les clés sont chiffrées au repos (AES-256-GCM) et ne sont jamais renvoyées au
            navigateur. Saisie, test de connexion et priorités par classe d’actifs sur la page
            Configurer.
          </p>
        </Panneau>

        <Panneau titre="Limites de risque">
          {!risque ? (
            <EtatVide message="Aucun paramètre de risque pour ce profil." />
          ) : (
            <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
              <Limite libelle="Risque par trade" valeur={`${formaterNombre(risque.risque_max_par_trade_pct, 2)} %`} />
              <Limite libelle="Risque total" valeur={`${formaterNombre(risque.risque_total_max_pct, 2)} %`} />
              <Limite libelle="Positions max" valeur={formaterNombre(risque.positions_max, 0)} />
              <Limite libelle="Corrélées max" valeur={formaterNombre(risque.positions_correlees_max, 0)} />
              <Limite libelle="Perte journalière" valeur={`${formaterNombre(risque.perte_journaliere_max_pct, 2)} %`} />
              <Limite libelle="Drawdown max" valeur={`${formaterNombre(risque.drawdown_max_pct, 2)} %`} />
              <Limite libelle="Levier max" valeur={`${formaterNombre(risque.levier_max, 0)}:1`} />
              <Limite
                libelle="Fenêtre macro"
                valeur={`${formaterNombre(risque.fenetre_evenement_macro_minutes, 0)} min`}
              />
              <Limite
                libelle="Stop-loss obligatoire"
                valeur={risque.stop_loss_obligatoire ? 'oui' : 'non'}
              />
            </dl>
          )}
          <p className="mt-3 text-xs text-texte-attenue">
            Ces plafonds sont appliqués par le moteur de risque en TypeScript côté serveur, pas par
            les prompts des agents. Édition en phase 3.
          </p>
        </Panneau>
      </div>
    </>
  );
}

function Limite({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded border border-bordure/60 px-2.5 py-1.5">
      <dt className="text-xs text-texte-attenue">{libelle}</dt>
      <dd className="chiffre text-sm">{valeur}</dd>
    </div>
  );
}

type LigneSymbole = {
  code: string;
  classe_actif: Instrument['classeActif'];
  devise_base: string | null;
  devise_cotation: string;
  taille_contrat: number;
  pas_cotation: number;
  decimales: number;
  spread_defaut_points: number;
  commission_par_unite: number;
  swap_long_points: number;
  swap_court_points: number;
  levier_max: number;
  horaires_seance: unknown;
};

function versInstrument(ligne: LigneSymbole): Instrument {
  return {
    code: ligne.code,
    classeActif: ligne.classe_actif,
    deviseBase: ligne.devise_base ?? ligne.code.slice(0, 3),
    deviseCotation: ligne.devise_cotation,
    tailleContrat: Number(ligne.taille_contrat),
    pasCotation: Number(ligne.pas_cotation),
    decimales: ligne.decimales,
    spreadDefautPoints: Number(ligne.spread_defaut_points),
    commissionParLot: Number(ligne.commission_par_unite),
    swapLongPoints: Number(ligne.swap_long_points),
    swapCourtPoints: Number(ligne.swap_court_points),
    levierMax: Number(ligne.levier_max),
    horairesSeance: {},
  };
}
