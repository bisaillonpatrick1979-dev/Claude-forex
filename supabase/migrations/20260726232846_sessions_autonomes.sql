-- Sessions autonomes : une enveloppe confiée aux agents, avec sa propre borne
-- de perte et sa propre fin.
--
-- Rapatriée depuis la base : appliquée sans être versionnée, donc le dépôt ne
-- pouvait plus reconstruire le schéma déployé.
--
-- L'index unique partiel garantit qu'un profil n'a jamais deux sessions
-- ouvertes en même temps. Deux enveloppes simultanées rendraient la question
-- « combien les agents ont-ils le droit d'engager ? » sans réponse.

create type public.statut_session as enum (
  'EN_COURS',
  'ARRETEE_UTILISATEUR',
  'ARRETEE_ENVELOPPE',
  'ARRETEE_KILL_SWITCH'
);

create table public.sessions_autonomes (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  portefeuille_id uuid not null references public.portefeuilles (id) on delete cascade,
  capital_alloue numeric(20, 8) not null,
  perte_max_pct numeric(6, 3) not null default 100,
  sommet_enveloppe numeric(20, 8) not null,
  equite_portefeuille_initiale numeric(20, 8) not null,
  statut public.statut_session not null default 'EN_COURS',
  raison_arret text,
  demarree_le timestamptz not null default now(),
  arretee_le timestamptz,
  maj_le timestamptz not null default now(),
  constraint sessions_capital_positif check (capital_alloue > 0),
  constraint sessions_perte_max check (perte_max_pct > 0 and perte_max_pct <= 100)
);

create unique index sessions_autonomes_active_idx
  on public.sessions_autonomes (profil_id) where statut = 'EN_COURS';

create index sessions_autonomes_profil_idx
  on public.sessions_autonomes (profil_id, demarree_le desc);

create trigger sessions_autonomes_maj before update on public.sessions_autonomes
  for each row execute function public.maj_horodatage();

alter table public.ordres
  add column if not exists session_id uuid references public.sessions_autonomes (id) on delete set null;
alter table public.propositions_ordres
  add column if not exists session_id uuid references public.sessions_autonomes (id) on delete set null;

create index ordres_session_idx on public.ordres (session_id) where session_id is not null;

alter table public.sessions_autonomes enable row level security;

create policy "sessions lisibles" on public.sessions_autonomes for select to authenticated
  using (profil_id = (select auth.uid()));

-- Le kill switch clôt aussi la session en cours : la geler sans la fermer
-- laisserait une enveloppe ouverte que plus rien n'alimente.
create or replace function public.declencher_kill_switch(p_raison text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profil uuid := auth.uid();
  v_raison text := coalesce(nullif(trim(p_raison), ''), 'Kill switch déclenché manuellement');
begin
  if v_profil is null then
    raise exception 'Authentification requise.';
  end if;

  update public.portefeuilles
     set gele = true, raison_gel = v_raison, gele_le = now()
   where profil_id = v_profil and not gele;

  update public.agents set actif = false where profil_id = v_profil and actif;

  update public.sessions_autonomes
     set statut = 'ARRETEE_KILL_SWITCH', raison_arret = v_raison, arretee_le = now()
   where profil_id = v_profil and statut = 'EN_COURS';

  update public.propositions_ordres
     set statut = 'EXPIREE', decide_le = now()
   where profil_id = v_profil
     and statut in ('PROPOSEE', 'EN_CONTROLE_RISQUE', 'EN_ATTENTE_VALIDATION');

  update public.ordres
     set statut = 'ANNULE', motif_fin = v_raison
   where profil_id = v_profil and statut in ('EN_ATTENTE', 'PARTIELLEMENT_REMPLI');

  update public.cycles
     set etat = 'ABANDONNE', termine_le = now(), erreur = v_raison
   where profil_id = v_profil
     and etat not in ('TERMINE', 'ECHOUE', 'ABANDONNE');

  insert into public.journal_audit (profil_id, acteur, action, entite, entite_id, details)
  values (v_profil, 'utilisateur', 'KILL_SWITCH', 'portefeuilles', null,
          jsonb_build_object('raison', v_raison));
end;
$fn$;
