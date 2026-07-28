'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { debrieferPositions, lancerCycleAgents } from '@/app/actions/cycles';
import { PiloteAutomatique } from '@/composants/agents/pilote-automatique';
import { EtatVide } from '@/composants/ui/panneau';
import type { Intervalle } from '@/lib/marche/types';
import { clientNavigateur } from '@/lib/supabase/client';
import type { Database } from '@/types/base-de-donnees';

/**
 * Fil de discussion des agents, en direct.
 *
 * Les messages arrivent par Supabase Realtime : chaque prise de parole est
 * d'abord écrite « en cours », puis complétée. On voit donc l'agent prendre la
 * parole avant qu'il ait fini, ce qui rend l'attente lisible au lieu de laisser
 * un écran figé pendant une minute.
 *
 * Un chargement initial complète le direct : Realtime ne rejoue pas ce qui
 * s'est passé avant l'abonnement, et un cycle lancé puis rechargé apparaîtrait
 * vide.
 */

type LigneMessage = Database['public']['Tables']['messages_agents']['Row'];

export interface AgentAffiche {
  readonly id: string;
  readonly nom: string;
  readonly couleur: string;
}

const LIBELLES_ETAPES: Readonly<Record<string, string>> = {
  EN_ATTENTE: 'En attente',
  COLLECTE_DONNEES: 'Collecte des données',
  ANALYSE: 'Analyse',
  DEBAT: 'Débat',
  SYNTHESE: 'Synthèse',
  PROPOSITION: 'Proposition',
  CONTROLE_RISQUE: 'Contrôle de risque',
  DECISION_PM: 'Décision finale',
  EXECUTION: 'Exécution',
  JOURNALISATION: 'Journalisation',
  TERMINE: 'Terminé',
  ECHOUE: 'Échec',
  ABANDONNE: 'Abandonné',
};

export function FilSpecialistes({
  profilId,
  symbole,
  intervalle,
  agents,
  blocage,
}: {
  profilId: string;
  symbole: string;
  intervalle: Intervalle;
  agents: readonly AgentAffiche[];
  /** Raison pour laquelle les agents ne peuvent rien engager, s'il y en a une. */
  blocage: string | null;
}) {
  const [messages, setMessages] = useState<readonly LigneMessage[]>([]);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [etatCycle, setEtatCycle] = useState<string | null>(null);
  const [retour, setRetour] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const zoneRef = useRef<HTMLDivElement>(null);

  const parAgent = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  // Dernier cycle connu, pour que le fil ne soit pas vide au chargement.
  useEffect(() => {
    let annule = false;
    const supabase = clientNavigateur();

    void (async () => {
      const { data: cycles } = await supabase
        .from('cycles')
        .select('id, etat')
        .eq('profil_id', profilId)
        .order('demarre_le', { ascending: false })
        .limit(1);

      const dernier = cycles?.[0];
      if (annule || !dernier) return;

      setCycleId(dernier.id);
      setEtatCycle(dernier.etat);

      const { data } = await supabase
        .from('messages_agents')
        .select('*')
        .eq('cycle_id', dernier.id)
        .order('sequence');

      if (!annule && data) setMessages(data);
    })();

    return () => {
      annule = true;
    };
  }, [profilId]);

  // Abonnement Realtime. Filtré sur le profil et non sur le cycle : au moment
  // où l'on s'abonne, le prochain cycle n'existe pas encore.
  useEffect(() => {
    const supabase = clientNavigateur();

    const canal = supabase
      .channel(`fil-${profilId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages_agents',
          filter: `profil_id=eq.${profilId}`,
        },
        (charge) => {
          const ligne = charge.new as LigneMessage | undefined;
          if (!ligne?.id) return;

          setMessages((precedents) => {
            const index = precedents.findIndex((message) => message.id === ligne.id);
            const suivants =
              index >= 0
                ? precedents.map((message) => (message.id === ligne.id ? ligne : message))
                : [...precedents, ligne];
            return [...suivants].sort((a, b) => a.sequence - b.sequence);
          });
          setCycleId((actuel) => actuel ?? ligne.cycle_id ?? null);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cycles', filter: `profil_id=eq.${profilId}` },
        (charge) => {
          const ligne = charge.new as { id?: string; etat?: string } | undefined;
          const identifiant = ligne?.id;
          if (!identifiant) return;
          setEtatCycle(ligne.etat ?? null);
          setCycleId((actuel) => {
            // Un nouveau cycle remplace l'affichage : on ne mélange pas deux
            // conversations dans le même fil.
            if (actuel && actuel !== identifiant) setMessages([]);
            return identifiant;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [profilId]);

  // Défilement automatique, sauf si l'utilisateur a remonté le fil pour lire.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const enBas = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 120;
    if (enBas) zone.scrollTop = zone.scrollHeight;
  }, [messages]);

  const lancer = useCallback(() => {
    setRetour(null);
    demarrer(async () => {
      const resultat = await lancerCycleAgents(symbole, intervalle);
      setRetour(resultat.message);
      if (resultat.cycleId) setCycleId(resultat.cycleId);
    });
  }, [symbole, intervalle]);

  const debriefer = useCallback(() => {
    setRetour(null);
    demarrer(async () => {
      const resultat = await debrieferPositions();
      setRetour(resultat.message);
    });
  }, []);

  const messagesDuCycle = cycleId
    ? messages.filter((message) => message.cycle_id === cycleId)
    : messages;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Une seule ligne de commandes. Tout ce qui n'est pas une analyse
          d'agent prend de la place sur les analyses d'agents. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={lancer}
          disabled={enCours}
          title={`Réunir les agents sur ${symbole}`}
          className="flex-1 truncate rounded bg-accent px-2 py-1 text-xs font-medium text-fond transition hover:opacity-90 disabled:opacity-50"
        >
          {enCours ? 'Cycle en cours…' : `Réunir sur ${symbole}`}
        </button>
        <button
          type="button"
          onClick={debriefer}
          disabled={enCours}
          title="Faire débriefer les positions fermées par l’agent de réflexion"
          className="shrink-0 rounded border border-bordure-vive px-2 py-1 text-xs transition hover:border-accent disabled:opacity-50"
        >
          Débriefer
        </button>
        {etatCycle ? (
          <span className="chiffre shrink-0 text-[0.68rem] uppercase tracking-wider text-texte-attenue">
            {LIBELLES_ETAPES[etatCycle] ?? etatCycle}
          </span>
        ) : null}
      </div>

      {blocage ? (
        <p
          className="shrink-0 rounded border border-alerte/40 bg-alerte/10 px-2 py-1 text-[0.7rem] leading-snug text-alerte"
          title={blocage}
        >
          {blocage}
        </p>
      ) : null}

      {/* Le compte rendu du dernier cycle tient sur deux lignes au plus. Il
          disait « aucun ordre en attente ni position ouverte à traiter » sur
          quatre lignes, au-dessus des analyses qu'on venait lire. */}
      {retour ? (
        <p
          className="shrink-0 overflow-hidden rounded border border-bordure bg-panneau-clair px-2 py-1 text-[0.7rem] leading-snug text-texte-attenue"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
          title={retour}
        >
          {retour}
        </p>
      ) : null}

      <PiloteAutomatique symbole={symbole} intervalle={intervalle} />

      <div ref={zoneRef} className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {messagesDuCycle.length === 0 ? (
          <EtatVide message="Aucune discussion pour l’instant. Réunissez les agents pour lancer un cycle." />
        ) : (
          messagesDuCycle.map((message) => (
            <Intervention key={message.id} message={message} agent={parAgent.get(message.agent_id ?? '')} />
          ))
        )}
      </div>
    </div>
  );
}

/** Liens réellement consultés par l'agent. Une affirmation tirée du web sans
 *  moyen de la vérifier ne vaut pas mieux qu'une hallucination bien tournée. */
function SourcesConsultees({ metadonnees }: { metadonnees: unknown }) {
  const brut = (metadonnees as { sources?: unknown } | null)?.sources;
  if (!Array.isArray(brut) || brut.length === 0) return null;

  const sources = brut.filter(
    (source): source is { titre: string; url: string } =>
      typeof (source as { url?: unknown })?.url === 'string',
  );
  if (sources.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-bordure/60 pt-1.5">
      {sources.map((source) => (
        <li key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.72rem] text-accent underline-offset-2 hover:underline"
          >
            {source.titre || source.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Trois points qui s'animent. Un texte figé ne dit pas si quelque chose
 *  travaille encore ou si l'écran est mort. */
function PointsSuspension() {
  return (
    <span aria-hidden>
      {[0, 150, 300].map((retard) => (
        <span
          key={retard}
          className="inline-block animate-pulse"
          style={{ animationDelay: `${retard}ms` }}
        >
          .
        </span>
      ))}
    </span>
  );
}

function Intervention({
  message,
  agent,
}: {
  message: LigneMessage;
  agent: AgentAffiche | undefined;
}) {
  const nom = agent?.nom ?? 'Firme';
  const couleur = agent?.couleur ?? '#64748b';

  return (
    <article className="rounded border border-bordure bg-panneau-clair px-3 py-2.5">
      <header className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: couleur }}
        />
        <span className="text-sm font-medium">{nom}</span>
        <span className="chiffre ml-auto text-[0.7rem] uppercase tracking-wider text-texte-attenue">
          {LIBELLES_ETAPES[message.etat] ?? message.etat}
          {message.tour > 0 ? ` · tour ${message.tour}` : ''}
        </span>
      </header>

      {/* Trois états, et la distinction compte : « réfléchit » veut dire qu'on
          attend le premier mot, « rédige » que le texte affiché est en train
          de s'écrire, et l'absence des deux que ce qu'on lit est définitif.
          Confondre les deux premiers ferait passer une réflexion longue pour
          un blocage. */}
      {message.en_cours && message.contenu.length === 0 ? (
        <p className="mt-1.5 text-sm italic text-texte-attenue">
          {nom} réfléchit<PointsSuspension />
        </p>
      ) : (
        <>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-texte">
            {message.contenu}
            {message.en_cours ? (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-accent"
              />
            ) : null}
          </p>
          {message.en_cours ? (
            <p className="mt-1 text-xs italic text-texte-attenue">
              {nom} rédige<PointsSuspension />
            </p>
          ) : null}
        </>
      )}

      <SourcesConsultees metadonnees={message.metadonnees} />

      {message.cout_usd !== null && message.cout_usd > 0 ? (
        <p className="chiffre mt-1 text-[0.7rem] text-texte-attenue/70">
          {message.tokens_entree ?? 0} + {message.tokens_sortie ?? 0} tokens ·{' '}
          {message.cout_usd.toFixed(4)} $ US
        </p>
      ) : null}
    </article>
  );
}
