'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { lancerCycleAgents } from '@/app/actions/cycles';
import { EtatVide } from '@/composants/ui/panneau';
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
  intervalle: string;
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

  const messagesDuCycle = cycleId
    ? messages.filter((message) => message.cycle_id === cycleId)
    : messages;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={lancer}
          disabled={enCours}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-fond transition hover:opacity-90 disabled:opacity-50"
        >
          {enCours ? 'Cycle en cours…' : `Réunir les agents sur ${symbole}`}
        </button>
        {etatCycle ? (
          <span className="chiffre text-[10px] uppercase tracking-wider text-texte-attenue">
            {LIBELLES_ETAPES[etatCycle] ?? etatCycle}
          </span>
        ) : null}
      </div>

      {blocage ? (
        <p className="shrink-0 rounded border border-alerte/40 bg-alerte/10 px-2 py-1 text-[11px] text-alerte">
          {blocage}
        </p>
      ) : null}

      {retour ? (
        <p className="shrink-0 rounded border border-bordure bg-panneau-clair px-2 py-1 text-[11px] text-texte-attenue">
          {retour}
        </p>
      ) : null}

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
    <article className="rounded border border-bordure bg-panneau-clair px-2 py-1.5">
      <header className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: couleur }}
        />
        <span className="text-[11px] font-medium">{nom}</span>
        <span className="chiffre ml-auto text-[9px] uppercase tracking-wider text-texte-attenue">
          {LIBELLES_ETAPES[message.etat] ?? message.etat}
          {message.tour > 0 ? ` · tour ${message.tour}` : ''}
        </span>
      </header>

      {message.en_cours ? (
        <p className="mt-1 text-[11px] italic text-texte-attenue">réfléchit…</p>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-texte">
          {message.contenu}
        </p>
      )}

      {message.cout_usd !== null && message.cout_usd > 0 ? (
        <p className="chiffre mt-1 text-[9px] text-texte-attenue/70">
          {message.tokens_entree ?? 0} + {message.tokens_sortie ?? 0} tokens ·{' '}
          {message.cout_usd.toFixed(4)} $ US
        </p>
      ) : null}
    </article>
  );
}
