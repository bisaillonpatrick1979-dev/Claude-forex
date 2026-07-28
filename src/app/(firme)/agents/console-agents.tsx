'use client';

import { useState, useTransition } from 'react';

import {
  basculerAgent,
  basculerDroit,
  definirModeleAgent,
  definirNiveauAutonomie,
  definirPerimetre,
  enregistrerLimites,
  enregistrerMandat,
  reactiverTousLesAgents,
  reprendreAgent,
  suspendreAgent,
  toutMettreEnValidation,
  type ResultatAgent,
} from '@/app/actions/agents';
import { DESCRIPTIONS_NIVEAUX, LIBELLES_ROLES } from '@/lib/agents/niveaux';
import type { NiveauAutonomie, RoleAgent } from '@/lib/agents/niveaux';
import {
  MODELES_PAR_FOURNISSEUR,
  accepteEffort,
  accepteTemperature,
  tarif,
} from '@/lib/ia/tarifs';
import { NIVEAUX_EFFORT, type FournisseurLLM, type NiveauEffort } from '@/lib/ia/types';
import { Panneau } from '@/composants/ui/panneau';

/**
 * Console de gouvernance : un agent par carte, ses droits en évidence.
 *
 * Chaque contrôle écrit immédiatement — pas de bouton « Enregistrer » global,
 * qui laisserait croire qu'un réglage est actif alors qu'il ne l'est pas.
 * Les limites chiffrées font exception : elles sont enregistrées ensemble,
 * parce qu'elles se lisent ensemble.
 */

export interface AgentAffiche {
  readonly id: string;
  readonly cle: string;
  readonly nom: string;
  readonly role: RoleAgent;
  readonly couleur: string;
  readonly actif: boolean;
  readonly fournisseur: FournisseurLLM;
  readonly modele: string;
  readonly temperature: number;
  readonly tokensMax: number;
  readonly effort: NiveauEffort;
  readonly mandat: string;
  readonly versionMandat: number | null;
  readonly niveau: NiveauAutonomie;
  readonly peutOuvrir: boolean;
  readonly peutFermer: boolean;
  readonly peutModifierProtections: boolean;
  readonly tailleMaxLots: number | null;
  readonly risqueMaxParTradePct: number | null;
  readonly tradesMaxParJour: number | null;
  readonly seuilValidationLots: number | null;
  readonly confianceMinimale: number | null;
  readonly validiteValidationMinutes: number;
  readonly classesAutorisees: readonly string[];
  readonly symbolesAutorises: readonly string[];
  readonly suspenduJusquA: string | null;
  readonly peutEtreAutonome: boolean;
}

const NIVEAUX: readonly NiveauAutonomie[] = ['OBSERVATEUR', 'PROPOSITION', 'AUTONOME'];
const CLASSES = ['FOREX', 'INDICE', 'ACTION', 'CRYPTO', 'MATIERE_PREMIERE'] as const;

const COULEUR_NIVEAU: Readonly<Record<NiveauAutonomie, string>> = {
  OBSERVATEUR: 'text-texte-attenue',
  PROPOSITION: 'text-accent',
  AUTONOME: 'text-alerte',
};

function texteOuVide(valeur: number | null): string {
  return valeur === null ? '' : String(valeur);
}

function nombreOuNull(valeur: string): number | null {
  const brut = valeur.trim();
  if (brut === '') return null;
  const nombre = Number.parseFloat(brut.replace(',', '.'));
  return Number.isFinite(nombre) ? nombre : null;
}

export function ConsoleAgents({ agents }: { agents: readonly AgentAffiche[] }) {
  const autonomes = agents.filter((agent) => agent.niveau === 'AUTONOME' && agent.actif);
  const inactifs = agents.filter((agent) => !agent.actif);
  const [repriseMessage, setRepriseMessage] = useState<string | null>(null);
  const [reprise, demarrerReprise] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <Panneau
        titre="Qui peut agir sur le portefeuille"
        action={
          <button
            type="button"
            disabled={reprise}
            onClick={() =>
              demarrerReprise(async () => {
                const resultat = await toutMettreEnValidation();
                setRepriseMessage(resultat.message);
              })
            }
            className="rounded border border-bordure px-2 py-1 text-xs text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
          >
            Tout remettre en validation
          </button>
        }
      >
        <p className="text-xs leading-relaxed text-texte-attenue">
          {autonomes.length === 0 ? (
            <>
              Aucun agent n’exécute seul : tout ordre proposé attend votre validation dans{' '}
              <span className="text-texte">Validation</span>.
            </>
          ) : (
            <>
              <span className="text-alerte">
                {autonomes.length} agent{autonomes.length > 1 ? 's' : ''} exécute
                {autonomes.length > 1 ? 'nt' : ''} sans vous demander
              </span>{' '}
              — {autonomes.map((agent) => agent.nom).join(', ')}. Les garde-fous de risque et le
              kill switch s’appliquent quand même.
            </>
          )}
        </p>
        {repriseMessage ? (
          <p className="mt-2 text-xs text-texte-attenue">{repriseMessage}</p>
        ) : null}
      </Panneau>

      {inactifs.length > 0 ? (
        <Panneau titre="Firme au repos">
          <p className="text-xs leading-relaxed text-texte-attenue">
            <span className="text-alerte">
              {inactifs.length} agent{inactifs.length > 1 ? 's' : ''} inacti
              {inactifs.length > 1 ? 'fs' : 'f'}
            </span>{' '}
            — la firme ne peut ni délibérer ni surveiller. C’est l’état que laisse un kill switch :
            le dégel rend le portefeuille, il ne remet pas les agents en service, et rien ne
            redémarre tout seul après un arrêt d’urgence.
          </p>
          <button
            type="button"
            disabled={reprise}
            onClick={() =>
              demarrerReprise(async () => {
                const resultat = await reactiverTousLesAgents();
                setRepriseMessage(resultat.message);
              })
            }
            className="mt-2 rounded border border-accent bg-accent/10 px-3 py-1.5 text-sm text-texte disabled:border-bordure disabled:bg-transparent disabled:text-texte-attenue"
          >
            Remettre les {inactifs.length} agent{inactifs.length > 1 ? 's' : ''} en service
          </button>
          <p className="mt-2 text-[0.7rem] leading-relaxed text-texte-attenue">
            Les permissions et les suspensions individuelles ne sont pas touchées : un agent
            suspendu le reste.
          </p>
        </Panneau>
      ) : null}

      {agents.map((agent) => (
        <CarteAgent key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function CarteAgent({ agent }: { agent: AgentAffiche }) {
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const [ouvert, setOuvert] = useState(false);

  function executer(action: () => Promise<ResultatAgent>) {
    demarrer(async () => {
      const resultat = await action();
      setMessage({ ok: resultat.ok, texte: resultat.message });
    });
  }

  const suspendu =
    agent.suspenduJusquA !== null && new Date(agent.suspenduJusquA).getTime() > Date.now();

  return (
    <Panneau>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-48 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: agent.couleur }}
            />
            <span className="text-sm">{agent.nom}</span>
            <span className="chiffre text-xs text-texte-attenue">
              {LIBELLES_ROLES[agent.role]}
            </span>
          </div>
          <p className="chiffre mt-0.5 text-xs text-texte-attenue">
            {agent.fournisseur} · {agent.modele}
            {agent.versionMandat !== null ? ` · mandat v${agent.versionMandat}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!agent.actif ? (
            <span className="chiffre text-xs uppercase tracking-wider text-texte-attenue">
              désactivé
            </span>
          ) : suspendu ? (
            <span className="chiffre text-xs uppercase tracking-wider text-alerte">
              suspendu
            </span>
          ) : (
            <span className={`chiffre text-xs uppercase tracking-wider ${COULEUR_NIVEAU[agent.niveau]}`}>
              {DESCRIPTIONS_NIVEAUX[agent.niveau].libelle}
            </span>
          )}
          <button
            type="button"
            disabled={enCours}
            onClick={() => executer(() => basculerAgent(agent.id, !agent.actif))}
            className="rounded border border-bordure px-2 py-1 text-xs text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
          >
            {agent.actif ? 'Désactiver' : 'Réactiver'}
          </button>
          <button
            type="button"
            onClick={() => setOuvert((valeur) => !valeur)}
            aria-expanded={ouvert}
            className="rounded border border-bordure px-2 py-1 text-xs text-texte-attenue transition-colors hover:text-texte"
          >
            {ouvert ? 'Replier' : 'Régler'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {NIVEAUX.map((niveau) => {
          const indisponible = niveau === 'AUTONOME' && !agent.peutEtreAutonome;
          return (
            <button
              key={niveau}
              type="button"
              disabled={enCours || indisponible}
              title={
                indisponible
                  ? 'Seuls le trader et le gestionnaire de portefeuille peuvent exécuter sans validation.'
                  : DESCRIPTIONS_NIVEAUX[niveau].description
              }
              onClick={() => executer(() => definirNiveauAutonomie(agent.id, niveau))}
              className={[
                'chiffre rounded px-2.5 py-1 text-xs uppercase tracking-wider transition-colors',
                agent.niveau === niveau
                  ? niveau === 'AUTONOME'
                    ? 'bg-alerte/20 text-alerte'
                    : niveau === 'PROPOSITION'
                      ? 'bg-accent/20 text-accent'
                      : 'bg-panneau-clair text-texte'
                  : 'border border-bordure text-texte-attenue hover:text-texte',
                indisponible ? 'cursor-not-allowed opacity-30' : '',
              ].join(' ')}
            >
              {DESCRIPTIONS_NIVEAUX[niveau].libelle}
            </button>
          );
        })}
        <span className="text-xs text-texte-attenue">
          {DESCRIPTIONS_NIVEAUX[agent.niveau].description}
        </span>
      </div>

      {ouvert ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-bordure pt-3">
          <Droits agent={agent} enCours={enCours} executer={executer} />
          <Limites agent={agent} enCours={enCours} executer={executer} />
          <Perimetre agent={agent} enCours={enCours} executer={executer} />
          <Suspension agent={agent} suspendu={suspendu} enCours={enCours} executer={executer} />
          <Modele agent={agent} enCours={enCours} executer={executer} />
          <Mandat agent={agent} enCours={enCours} executer={executer} />
        </div>
      ) : null}

      {message ? (
        <p
          className={`mt-2 text-xs ${message.ok ? 'text-texte-attenue' : 'text-baisse'}`}
          role={message.ok ? undefined : 'alert'}
        >
          {message.texte}
        </p>
      ) : null}
    </Panneau>
  );
}

type Executeur = (action: () => Promise<ResultatAgent>) => void;

function Droits({
  agent,
  enCours,
  executer,
}: {
  agent: AgentAffiche;
  enCours: boolean;
  executer: Executeur;
}) {
  const droits = [
    { cle: 'peut_ouvrir', libelle: 'Ouvrir une position', valeur: agent.peutOuvrir },
    { cle: 'peut_fermer', libelle: 'Fermer une position', valeur: agent.peutFermer },
    {
      cle: 'peut_modifier_protections',
      libelle: 'Déplacer stop / objectif',
      valeur: agent.peutModifierProtections,
    },
  ] as const;

  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <legend className="text-xs uppercase tracking-[0.14em] text-texte-attenue">Droits</legend>
      {droits.map((droit) => (
        <label key={droit.cle} className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={droit.valeur}
            disabled={enCours || agent.niveau === 'OBSERVATEUR'}
            onChange={(evenement) =>
              executer(() => basculerDroit(agent.id, droit.cle, evenement.target.checked))
            }
            className="accent-accent disabled:opacity-40"
          />
          <span className={agent.niveau === 'OBSERVATEUR' ? 'text-texte-attenue' : undefined}>
            {droit.libelle}
          </span>
        </label>
      ))}
      {agent.niveau === 'OBSERVATEUR' ? (
        <span className="text-xs text-texte-attenue">
          Un observateur n’a aucun droit d’action : passez-le en proposition d’abord.
        </span>
      ) : null}
    </fieldset>
  );
}

function Limites({
  agent,
  enCours,
  executer,
}: {
  agent: AgentAffiche;
  enCours: boolean;
  executer: Executeur;
}) {
  const [taille, setTaille] = useState(texteOuVide(agent.tailleMaxLots));
  const [risque, setRisque] = useState(texteOuVide(agent.risqueMaxParTradePct));
  const [trades, setTrades] = useState(texteOuVide(agent.tradesMaxParJour));
  const [seuil, setSeuil] = useState(texteOuVide(agent.seuilValidationLots));
  const [confiance, setConfiance] = useState(texteOuVide(agent.confianceMinimale));
  const [validite, setValidite] = useState(String(agent.validiteValidationMinutes));

  const champs = [
    { libelle: 'Taille max (lots)', valeur: taille, definir: setTaille, pas: '0.01' },
    { libelle: 'Risque max / trade (%)', valeur: risque, definir: setRisque, pas: '0.05' },
    { libelle: 'Trades / jour', valeur: trades, definir: setTrades, pas: '1' },
    { libelle: 'Seuil de validation (lots)', valeur: seuil, definir: setSeuil, pas: '0.01' },
    { libelle: 'Confiance minimale', valeur: confiance, definir: setConfiance, pas: '5' },
    { libelle: 'Validité (min)', valeur: validite, definir: setValidite, pas: '5' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-[0.14em] text-texte-attenue">Limites</p>
      <div className="flex flex-wrap items-end gap-2">
        {champs.map((champ) => (
          <label key={champ.libelle} className="flex flex-col gap-1">
            <span className="text-[0.72rem] text-texte-attenue">{champ.libelle}</span>
            <input
              type="number"
              min={0}
              step={champ.pas}
              value={champ.valeur}
              disabled={enCours}
              onChange={(evenement) => champ.definir(evenement.target.value)}
              className="chiffre w-28 rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-40"
            />
          </label>
        ))}
        <button
          type="button"
          disabled={enCours}
          onClick={() =>
            executer(() =>
              enregistrerLimites(agent.id, {
                tailleMaxLots: nombreOuNull(taille),
                risqueMaxParTradePct: nombreOuNull(risque),
                tradesMaxParJour: nombreOuNull(trades),
                seuilValidationLots: nombreOuNull(seuil),
                confianceMinimale: nombreOuNull(confiance),
                validiteValidationMinutes: nombreOuNull(validite) ?? 30,
              }),
            )
          }
          className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-fond disabled:opacity-40"
        >
          Enregistrer
        </button>
      </div>
      <p className="text-xs leading-relaxed text-texte-attenue">
        Vide = pas de limite propre à l’agent ; les plafonds du portefeuille s’appliquent de toute
        façon, et c’est toujours le plus strict des deux qui gagne. Le seuil de validation ne
        concerne qu’un agent autonome : au-delà, il vous redemande.
      </p>
    </div>
  );
}

function Perimetre({
  agent,
  enCours,
  executer,
}: {
  agent: AgentAffiche;
  enCours: boolean;
  executer: Executeur;
}) {
  const [classes, setClasses] = useState<readonly string[]>(agent.classesAutorisees);
  const [symboles, setSymboles] = useState(agent.symbolesAutorises.join(' '));

  function basculerClasse(classe: string) {
    const suivant = classes.includes(classe)
      ? classes.filter((valeur) => valeur !== classe)
      : [...classes, classe];
    setClasses(suivant);
    executer(() => definirPerimetre(agent.id, suivant, symboles.split(/[\s,]+/)));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-[0.14em] text-texte-attenue">Périmètre</p>
      <div className="flex flex-wrap items-center gap-2">
        {CLASSES.map((classe) => (
          <button
            key={classe}
            type="button"
            disabled={enCours}
            onClick={() => basculerClasse(classe)}
            className={[
              'chiffre rounded px-2 py-1 text-[0.72rem] uppercase tracking-wider transition-colors',
              classes.includes(classe)
                ? 'bg-panneau-clair text-texte'
                : 'border border-bordure text-texte-attenue hover:text-texte',
            ].join(' ')}
          >
            {classe}
          </button>
        ))}
        <input
          type="text"
          value={symboles}
          disabled={enCours}
          placeholder="EURUSD NAS100…"
          onChange={(evenement) => setSymboles(evenement.target.value)}
          onBlur={() => executer(() => definirPerimetre(agent.id, classes, symboles.split(/[\s,]+/)))}
          className="chiffre min-w-44 flex-1 rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-40"
        />
      </div>
      <p className="text-xs text-texte-attenue">
        Rien de coché et champ vide = aucune restriction d’instrument.
      </p>
    </div>
  );
}

function Suspension({
  agent,
  suspendu,
  enCours,
  executer,
}: {
  agent: AgentAffiche;
  suspendu: boolean;
  enCours: boolean;
  executer: Executeur;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs uppercase tracking-[0.14em] text-texte-attenue">Suspension</p>
      {[30, 120, 1440].map((minutes) => (
        <button
          key={minutes}
          type="button"
          disabled={enCours}
          onClick={() => executer(() => suspendreAgent(agent.id, minutes))}
          className="rounded border border-bordure px-2 py-1 text-xs text-texte-attenue transition-colors hover:text-texte disabled:opacity-40"
        >
          {minutes >= 1440 ? '24 h' : `${minutes} min`}
        </button>
      ))}
      {suspendu ? (
        <button
          type="button"
          disabled={enCours}
          onClick={() => executer(() => reprendreAgent(agent.id))}
          className="rounded border border-bordure px-2 py-1 text-xs text-accent transition-colors hover:text-texte disabled:opacity-40"
        >
          Lever la suspension
        </button>
      ) : null}
      <span className="text-xs text-texte-attenue">
        Met l’agent de côté sans perdre ses réglages, contrairement à la désactivation.
      </span>
    </div>
  );
}

/**
 * Choix du modèle, agent par agent.
 *
 * C'est le seul levier de coût qui ne dégrade pas la firme uniformément :
 * faire tourner cinq analystes sur un petit modèle rapide pendant que le
 * gestionnaire de portefeuille garde le plus fort divise la facture sans
 * toucher à la décision finale. Le tarif est affiché à côté de chaque modèle
 * pour que l'arbitrage se fasse sur des chiffres, pas sur une réputation.
 *
 * Les quatre réglages s'enregistrent ensemble, contrairement au reste de cette
 * console : changer de fournisseur sans changer de modèle produirait un couple
 * incohérent, refusé côté serveur. Ils se lisent ensemble, ils s'écrivent
 * ensemble.
 *
 * Température et effort sont **disjoints** chez Anthropic — aucun modèle
 * n'accepte les deux. Le contrôle refusé par le modèle choisi est désactivé et
 * dit pourquoi, plutôt que de laisser régler une valeur qui ferait échouer
 * l'appel avec un 400.
 */
function Modele({
  agent,
  enCours,
  executer,
}: {
  agent: AgentAffiche;
  enCours: boolean;
  executer: Executeur;
}) {
  const [fournisseur, setFournisseur] = useState<FournisseurLLM>(agent.fournisseur);
  const [modele, setModele] = useState(agent.modele);
  const [temperature, setTemperature] = useState(String(agent.temperature));
  const [tokensMax, setTokensMax] = useState(String(agent.tokensMax));
  const [effort, setEffort] = useState<NiveauEffort>(agent.effort);

  const proposes = MODELES_PAR_FOURNISSEUR[fournisseur];
  const temperatureUtile = accepteTemperature(fournisseur, modele);
  const effortUtile = accepteEffort(fournisseur, modele);
  const grille = tarif(modele);

  const modifie =
    fournisseur !== agent.fournisseur ||
    modele !== agent.modele ||
    Number(temperature) !== agent.temperature ||
    Number(tokensMax) !== agent.tokensMax ||
    effort !== agent.effort;

  function changerFournisseur(valeur: FournisseurLLM) {
    setFournisseur(valeur);
    // Un modèle d'un autre fournisseur ne survit pas au changement : le
    // serveur le refuserait, autant proposer immédiatement un couple valide.
    setModele(MODELES_PAR_FOURNISSEUR[valeur][0] ?? '');
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-[0.14em] text-texte-attenue">Modèle</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Fournisseur</span>
          <select
            value={fournisseur}
            disabled={enCours}
            onChange={(evenement) => changerFournisseur(evenement.target.value as FournisseurLLM)}
            className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-40"
          >
            {(Object.keys(MODELES_PAR_FOURNISSEUR) as FournisseurLLM[]).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Modèle</span>
          <select
            value={modele}
            disabled={enCours}
            onChange={(evenement) => setModele(evenement.target.value)}
            className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-40"
          >
            {proposes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Tokens max</span>
          <input
            type="number"
            min={2000}
            max={64000}
            step={1000}
            value={tokensMax}
            disabled={enCours}
            onChange={(evenement) => setTokensMax(evenement.target.value)}
            className="chiffre w-24 rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Température</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            disabled={enCours || !temperatureUtile}
            title={
              temperatureUtile
                ? undefined
                : `${modele} refuse le paramètre de température : il n’est pas transmis.`
            }
            onChange={(evenement) => setTemperature(evenement.target.value)}
            className="chiffre w-20 rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-30"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-texte-attenue">Effort</span>
          <select
            value={effort}
            disabled={enCours || !effortUtile}
            title={
              effortUtile
                ? undefined
                : `${modele} refuse le paramètre d’effort : il n’est pas transmis.`
            }
            onChange={(evenement) => setEffort(evenement.target.value as NiveauEffort)}
            className="chiffre rounded border border-bordure bg-fond px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-30"
          >
            {NIVEAUX_EFFORT.map((niveau) => (
              <option key={niveau} value={niveau}>
                {niveau}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={enCours || !modifie}
          onClick={() =>
            executer(() =>
              definirModeleAgent(agent.id, {
                fournisseur,
                modele,
                temperature,
                tokensMax,
                effort,
              }),
            )
          }
          className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-fond disabled:opacity-40"
        >
          Appliquer
        </button>
      </div>

      <p className="text-xs leading-relaxed text-texte-attenue">
        {grille ? (
          <>
            <span className="chiffre">
              {grille.entree.toFixed(2)} $ / {grille.sortie.toFixed(2)} $
            </span>{' '}
            par million de tokens (entrée / sortie).
          </>
        ) : (
          'Tarif inconnu pour ce modèle : la dépense sera comptée comme non chiffrée plutôt que comme nulle.'
        )}{' '}
        {temperatureUtile
          ? null
          : 'La température est ignorée par ce modèle et n’est pas envoyée. '}
        {effortUtile ? null : 'L’effort est ignoré par ce modèle et n’est pas envoyé. '}
      </p>
    </div>
  );
}

function Mandat({
  agent,
  enCours,
  executer,
}: {
  agent: AgentAffiche;
  enCours: boolean;
  executer: Executeur;
}) {
  const [contenu, setContenu] = useState(agent.mandat);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-[0.14em] text-texte-attenue">
        Mandat {agent.versionMandat !== null ? `(version ${agent.versionMandat})` : ''}
      </p>
      <textarea
        value={contenu}
        rows={6}
        disabled={enCours}
        onChange={(evenement) => setContenu(evenement.target.value)}
        className="w-full rounded border border-bordure bg-fond px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-accent disabled:opacity-40"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={enCours || contenu.trim() === agent.mandat.trim()}
          onClick={() => executer(() => enregistrerMandat(agent.id, contenu))}
          className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-fond disabled:opacity-40"
        >
          Publier une nouvelle version
        </button>
        <span className="text-xs text-texte-attenue">
          L’ancienne version est conservée : une décision passée reste rattachée au texte qui l’a
          produite.
        </span>
      </div>
    </div>
  );
}
