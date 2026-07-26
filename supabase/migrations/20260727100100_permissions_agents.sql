-- Gouvernance des agents (phase 4a).
--
-- Question à laquelle cette table répond : « qu'est-ce que cet agent-là a le
-- droit de faire tout seul ? ». Elle est distincte de parametres_risque, qui
-- répond à « jusqu'où le portefeuille peut aller, quel que soit l'agent ».
--
--   permissions_agents  → qui agit, et à partir de quand l'humain tranche
--   parametres_risque   → combien, au maximum
--
-- Les deux sont appliquées par du code TypeScript serveur, dans cet ordre :
-- permission d'abord (a-t-il le droit ?), garde-fous ensuite (quelle taille ?).
-- Aucune des deux n'est confiée à un prompt.

create type public.niveau_autonomie as enum (
  -- Analyse et débat seulement : aucune écriture sur le portefeuille.
  'OBSERVATEUR',
  -- Peut proposer un ordre ; l'exécution attend une validation humaine.
  'PROPOSITION',
  -- Peut faire exécuter ses ordres sans validation, dans ses limites.
  'AUTONOME'
);

create table public.permissions_agents (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  agent_id uuid not null unique references public.agents (id) on delete cascade,
  niveau public.niveau_autonomie not null default 'OBSERVATEUR',

  -- Droits d'action, indépendants du niveau : un agent peut avoir le droit de
  -- fermer une position sans avoir celui d'en ouvrir une.
  peut_ouvrir boolean not null default false,
  peut_fermer boolean not null default false,
  peut_modifier_protections boolean not null default false,

  -- Plafonds propres à l'agent. `null` = pas de limite propre ; les limites du
  -- portefeuille s'appliquent de toute façon. Une valeur ici ne peut que
  -- resserrer, jamais élargir : la fusion prend le minimum.
  taille_max_lots numeric(20, 8),
  risque_max_par_trade_pct numeric(6, 3),
  trades_max_par_jour integer,

  -- Périmètre. Tableau vide = aucune restriction de périmètre.
  classes_autorisees public.classe_actif[] not null default '{}',
  symboles_autorises text[] not null default '{}',

  -- Au-delà de ce nombre de lots, un agent autonome repasse par une validation
  -- humaine. C'est la soupape : autonome sur les petites tailles, encadré sur
  -- les grosses.
  seuil_validation_lots numeric(20, 8),
  -- Une proposition en dessous de ce degré de confiance est refusée d'office.
  confiance_minimale smallint,
  -- Durée de vie d'une proposition en attente de validation.
  validite_validation_minutes integer not null default 30,

  -- Suspension temporaire, sans perdre la configuration de l'agent.
  suspendu_jusqu_a timestamptz,
  raison_suspension text,

  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),

  constraint permissions_bornes check (
    (taille_max_lots is null or taille_max_lots > 0)
    and (risque_max_par_trade_pct is null
         or (risque_max_par_trade_pct > 0 and risque_max_par_trade_pct <= 10))
    and (trades_max_par_jour is null or trades_max_par_jour >= 0)
    and (seuil_validation_lots is null or seuil_validation_lots > 0)
    and (confiance_minimale is null
         or (confiance_minimale >= 0 and confiance_minimale <= 100))
    and validite_validation_minutes >= 1
    and validite_validation_minutes <= 1440
  )
);

create index permissions_agents_profil_idx on public.permissions_agents (profil_id);

create trigger permissions_agents_maj before update on public.permissions_agents
  for each row execute function public.maj_horodatage();

-- L'autonomie n'est pas ouverte à tous les rôles. Un analyste ou un chercheur
-- n'a pas de mandat d'exécution : lui accorder l'autonomie n'aurait aucun sens
-- et créerait un chemin d'écriture non prévu par l'organigramme. Le contrôle
-- est en base et pas seulement dans l'UI, parce que la policy RLS autorise le
-- propriétaire à écrire cette table depuis le navigateur.
create or replace function public.verifier_niveau_autonomie()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_role public.role_agent;
begin
  if new.niveau = 'AUTONOME' then
    select role into v_role from public.agents where id = new.agent_id;
    if v_role is null or v_role not in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE') then
      raise exception
        'Autonomie refusée : seuls le trader et le gestionnaire de portefeuille peuvent exécuter sans validation (rôle % ).',
        coalesce(v_role::text, 'inconnu');
    end if;
  end if;
  return new;
end;
$fn$;

create trigger permissions_agents_verifie_niveau
  before insert or update on public.permissions_agents
  for each row execute function public.verifier_niveau_autonomie();

-- Toute modification de permission laisse une trace : c'est le genre de
-- réglage qu'on veut pouvoir dater après coup (« depuis quand cet agent
-- tradait-il seul ? »). SECURITY DEFINER parce que journal_audit n'accepte
-- aucune écriture depuis le navigateur.
create or replace function public.journaliser_permission_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.journal_audit (profil_id, acteur, action, entite, entite_id, details)
  values (
    new.profil_id,
    'utilisateur',
    case when tg_op = 'INSERT' then 'PERMISSION_AGENT_CREEE' else 'PERMISSION_AGENT_MODIFIEE' end,
    'permissions_agents',
    new.agent_id::text,
    jsonb_build_object(
      'niveau_avant', case when tg_op = 'UPDATE' then old.niveau::text end,
      'niveau_apres', new.niveau::text,
      'apres', to_jsonb(new) - 'id' - 'profil_id' - 'cree_le' - 'maj_le'
    )
  );
  return new;
end;
$fn$;

create trigger permissions_agents_journal_insert
  after insert on public.permissions_agents
  for each row execute function public.journaliser_permission_agent();

create trigger permissions_agents_journal_update
  after update on public.permissions_agents
  for each row
  when (old.* is distinct from new.*)
  execute function public.journaliser_permission_agent();

-- --- RLS : posture 1 (configuration, écrite par le propriétaire) -------------

alter table public.permissions_agents enable row level security;

create policy "permissions lisibles" on public.permissions_agents for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "permissions modifiables" on public.permissions_agents for update to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));
create policy "permissions creables" on public.permissions_agents for insert to authenticated
  with check (profil_id = (select auth.uid()));

-- --- Amorçage ---------------------------------------------------------------
-- Défaut volontairement fermé : personne n'est autonome au départ, et seuls
-- les deux rôles d'exécution peuvent seulement proposer. Ouvrir des droits est
-- une décision explicite de l'utilisateur, jamais un défaut hérité.

insert into public.permissions_agents
  (profil_id, agent_id, niveau, peut_ouvrir, peut_fermer)
select
  a.profil_id,
  a.id,
  case
    when a.role in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE') then 'PROPOSITION'
    else 'OBSERVATEUR'
  end::public.niveau_autonomie,
  a.role in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE'),
  a.role in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE')
from public.agents a
on conflict (agent_id) do nothing;

-- Le kill switch coupe déjà les agents (agents.actif = false) ; il n'a pas
-- besoin de toucher aux permissions, qu'on veut retrouver intactes au
-- redémarrage. La suspension, elle, est un geste distinct et réversible.

-- --- Création de la firme : les permissions naissent avec les agents ---------

create or replace function public.initialiser_permissions_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.permissions_agents
    (profil_id, agent_id, niveau, peut_ouvrir, peut_fermer)
  values (
    new.profil_id,
    new.id,
    case
      when new.role in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE') then 'PROPOSITION'
      else 'OBSERVATEUR'
    end::public.niveau_autonomie,
    new.role in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE'),
    new.role in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE')
  )
  on conflict (agent_id) do nothing;
  return new;
end;
$fn$;

-- Attaché à la création d'agent plutôt qu'à initialiser_profil() : un agent
-- ajouté plus tard, par l'UI ou par une migration, obtient ses permissions par
-- défaut sans qu'on ait à y penser. Aucun agent ne peut exister sans ligne de
-- permission.
create trigger agents_permissions_par_defaut
  after insert on public.agents
  for each row execute function public.initialiser_permissions_agent();
