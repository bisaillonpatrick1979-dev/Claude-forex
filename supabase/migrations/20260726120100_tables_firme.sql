-- Tables « firme » : l'utilisateur, ses agents, ses limites, son portefeuille.

-- Un profil par utilisateur authentifié. C'est la racine de toutes les
-- politiques RLS : chaque table métier porte un profil_id dénormalisé pour
-- éviter des jointures récursives dans les policies (coûteuses et fragiles).
create table public.profils (
  id uuid primary key references auth.users (id) on delete cascade,
  courriel text not null,
  nom_affichage text,
  mode_operation public.mode_operation not null default 'PAPIER_AUTONOME',
  -- Plafond de dépense LLM par jour : au-delà, l'orchestrateur met les agents en pause.
  plafond_cout_quotidien_usd numeric(10, 2) not null default 5.00,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

create trigger profils_maj before update on public.profils
  for each row execute function public.maj_horodatage();

-- Les garde-fous vivent en base et sont appliqués par du code TypeScript
-- serveur, jamais par un prompt. Les valeurs par défaut sont celles du cahier
-- des charges.
create table public.parametres_risque (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null unique references public.profils (id) on delete cascade,
  risque_max_par_trade_pct numeric(6, 3) not null default 1.000,
  risque_total_max_pct numeric(6, 3) not null default 5.000,
  positions_max integer not null default 5,
  positions_correlees_max integer not null default 2,
  seuil_correlation numeric(4, 3) not null default 0.700,
  perte_journaliere_max_pct numeric(6, 3) not null default 3.000,
  drawdown_max_pct numeric(6, 3) not null default 15.000,
  levier_max numeric(6, 2) not null default 10.00,
  fenetre_evenement_macro_minutes integer not null default 30,
  stop_loss_obligatoire boolean not null default true,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  constraint parametres_risque_bornes check (
    risque_max_par_trade_pct > 0 and risque_max_par_trade_pct <= 10
    and risque_total_max_pct > 0 and risque_total_max_pct <= 50
    and positions_max > 0 and positions_max <= 50
    and levier_max > 0 and levier_max <= 30
  )
);

create trigger parametres_risque_maj before update on public.parametres_risque
  for each row execute function public.maj_horodatage();

-- Un agent = une entité éditable dans l'UI. Le mandat (system prompt) est
-- versionné dans mandats_agents pour pouvoir revenir en arrière et pour tracer
-- quelle version a produit quelle décision.
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  cle text not null,
  nom text not null,
  role public.role_agent not null,
  fournisseur_llm public.fournisseur_llm not null default 'mock',
  modele text not null default 'mock-1',
  temperature numeric(3, 2) not null default 0.30,
  tokens_max integer not null default 2000,
  outils_autorises text[] not null default '{}',
  couleur text not null default '#7dd3fc',
  ordre_affichage integer not null default 0,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (profil_id, cle),
  constraint agents_temperature check (temperature >= 0 and temperature <= 2)
);

create index agents_profil_idx on public.agents (profil_id, ordre_affichage);

create trigger agents_maj before update on public.agents
  for each row execute function public.maj_horodatage();

create table public.mandats_agents (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  version integer not null,
  contenu text not null,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (agent_id, version)
);

-- Un seul mandat actif par agent : c'est celui que l'orchestrateur charge.
create unique index mandats_agents_actif_idx
  on public.mandats_agents (agent_id) where actif;

-- Le portefeuille est l'unité comptable. sommet_equite sert au calcul du
-- drawdown depuis le plus haut ; gele est levé par le kill switch.
create table public.portefeuilles (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  nom text not null default 'Portefeuille papier',
  devise text not null default 'USD',
  mode public.mode_operation not null default 'PAPIER_AUTONOME',
  capital_initial numeric(20, 8) not null default 100000,
  solde numeric(20, 8) not null default 100000,
  equite numeric(20, 8) not null default 100000,
  marge_utilisee numeric(20, 8) not null default 0,
  sommet_equite numeric(20, 8) not null default 100000,
  gele boolean not null default false,
  raison_gel text,
  gele_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

create index portefeuilles_profil_idx on public.portefeuilles (profil_id);

create trigger portefeuilles_maj before update on public.portefeuilles
  for each row execute function public.maj_horodatage();
