-- Cycles de décision, production des agents, chaîne proposition → risque → ordre
-- → position → transaction.

-- Un cycle = une exécution de la machine à états. instantane_donnees fige le
-- snapshot de marché passé aux agents : c'est ce qui permet de vérifier après
-- coup qu'un agent n'a pas inventé un prix.
create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  portefeuille_id uuid not null references public.portefeuilles (id) on delete cascade,
  symbole_id uuid not null references public.symboles (id) on delete restrict,
  intervalle public.intervalle not null,
  etat public.etat_cycle not null default 'EN_ATTENTE',
  declencheur public.declencheur_cycle not null default 'MANUEL',
  tours_debat integer not null default 2,
  budget_appels_llm integer not null default 30,
  appels_llm_utilises integer not null default 0,
  budget_secondes integer not null default 300,
  cout_usd numeric(12, 6) not null default 0,
  instantane_donnees jsonb,
  erreur text,
  demarre_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  termine_le timestamptz
);

create index cycles_profil_idx on public.cycles (profil_id, demarre_le desc);
create index cycles_symbole_idx on public.cycles (symbole_id, demarre_le desc);
create index cycles_actifs_idx on public.cycles (etat)
  where etat not in ('TERMINE', 'ECHOUE', 'ABANDONNE');

create trigger cycles_maj before update on public.cycles
  for each row execute function public.maj_horodatage();

-- Chaque message est écrit dès qu'il est produit, pas à la fin du cycle :
-- c'est ce qui alimente le streaming vers l'UI via Supabase Realtime.
create table public.messages_agents (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete set null,
  etat public.etat_cycle not null,
  tour integer not null default 0,
  sequence integer not null,
  contenu text not null default '',
  resume text,
  -- true tant que les tokens arrivent : l'UI affiche « rédige… ».
  en_cours boolean not null default false,
  tokens_entree integer,
  tokens_sortie integer,
  cout_usd numeric(12, 6),
  latence_ms integer,
  metadonnees jsonb not null default '{}'::jsonb,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (cycle_id, sequence)
);

create index messages_agents_cycle_idx on public.messages_agents (cycle_id, sequence);

create trigger messages_agents_maj before update on public.messages_agents
  for each row execute function public.maj_horodatage();

-- Sortie structurée d'un analyste (étage 1). contenu garde le texte, donnees
-- garde les niveaux chiffrés extraits et validés contre le snapshot.
create table public.rapports_analyse (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  role public.role_agent not null,
  contenu text not null,
  donnees jsonb not null default '{}'::jsonb,
  confiance smallint,
  cree_le timestamptz not null default now(),
  constraint rapports_confiance check (confiance is null or (confiance >= 0 and confiance <= 100))
);

create index rapports_analyse_cycle_idx on public.rapports_analyse (cycle_id);

-- Sortie du directeur de recherche : la vue de marché arbitrée après débat.
create table public.vues_marche (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  cycle_id uuid not null unique references public.cycles (id) on delete cascade,
  direction text not null,
  conviction smallint not null,
  horizon text,
  niveau_invalidation numeric(20, 8),
  resume text not null,
  cree_le timestamptz not null default now(),
  constraint vues_marche_direction check (direction in ('HAUSSIER', 'BAISSIER', 'NEUTRE')),
  constraint vues_marche_conviction check (conviction >= 0 and conviction <= 100)
);

-- Proposition du trader. Un stop_loss nul est refusé par le moteur de risque,
-- mais la proposition est conservée pour que le refus soit traçable dans l'UI.
create table public.propositions_ordres (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  portefeuille_id uuid not null references public.portefeuilles (id) on delete cascade,
  symbole_id uuid not null references public.symboles (id) on delete restrict,
  agent_id uuid references public.agents (id) on delete set null,
  sens public.sens_ordre not null,
  type_ordre public.type_ordre not null default 'MARCHE',
  quantite numeric(20, 8) not null,
  prix_entree numeric(20, 8),
  stop_loss numeric(20, 8),
  take_profit numeric(20, 8),
  valide_jusqu_a timestamptz,
  raisonnement text not null,
  statut public.statut_proposition not null default 'PROPOSEE',
  decide_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  constraint propositions_quantite check (quantite > 0)
);

create index propositions_ordres_cycle_idx on public.propositions_ordres (cycle_id);
create index propositions_ordres_attente_idx
  on public.propositions_ordres (profil_id, cree_le desc)
  where statut = 'EN_ATTENTE_VALIDATION';

create trigger propositions_ordres_maj before update on public.propositions_ordres
  for each row execute function public.maj_horodatage();

-- Verdict du gestionnaire de risque. controles garde le détail de chaque
-- garde-fou évalué, pour que l'UI affiche la raison exacte d'un rejet.
create table public.decisions_risque (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  proposition_id uuid not null references public.propositions_ordres (id) on delete cascade,
  decision public.decision_risque not null,
  raison text not null,
  quantite_demandee numeric(20, 8) not null,
  quantite_autorisee numeric(20, 8) not null default 0,
  risque_estime_pct numeric(8, 4),
  controles jsonb not null default '[]'::jsonb,
  cree_le timestamptz not null default now()
);

create index decisions_risque_proposition_idx on public.decisions_risque (proposition_id);

create table public.ordres (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  portefeuille_id uuid not null references public.portefeuilles (id) on delete cascade,
  symbole_id uuid not null references public.symboles (id) on delete restrict,
  proposition_id uuid references public.propositions_ordres (id) on delete set null,
  cycle_id uuid references public.cycles (id) on delete set null,
  sens public.sens_ordre not null,
  type_ordre public.type_ordre not null,
  quantite numeric(20, 8) not null,
  quantite_remplie numeric(20, 8) not null default 0,
  prix_demande numeric(20, 8),
  prix_moyen_rempli numeric(20, 8),
  stop_loss numeric(20, 8),
  take_profit numeric(20, 8),
  statut public.statut_ordre not null default 'EN_ATTENTE',
  valide_jusqu_a timestamptz,
  motif_fin text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  rempli_le timestamptz
);

create index ordres_portefeuille_idx on public.ordres (portefeuille_id, cree_le desc);
create index ordres_ouverts_idx on public.ordres (portefeuille_id)
  where statut in ('EN_ATTENTE', 'PARTIELLEMENT_REMPLI');

create trigger ordres_maj before update on public.ordres
  for each row execute function public.maj_horodatage();

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  portefeuille_id uuid not null references public.portefeuilles (id) on delete cascade,
  symbole_id uuid not null references public.symboles (id) on delete restrict,
  cycle_id uuid references public.cycles (id) on delete set null,
  ordre_ouverture_id uuid references public.ordres (id) on delete set null,
  sens public.sens_ordre not null,
  quantite numeric(20, 8) not null,
  prix_entree numeric(20, 8) not null,
  prix_sortie numeric(20, 8),
  stop_loss numeric(20, 8),
  take_profit numeric(20, 8),
  marge_immobilisee numeric(20, 8) not null default 0,
  commission_totale numeric(20, 8) not null default 0,
  swap_total numeric(20, 8) not null default 0,
  pnl_realise numeric(20, 8),
  statut public.statut_position not null default 'OUVERTE',
  motif_sortie text,
  ouvert_le timestamptz not null default now(),
  ferme_le timestamptz,
  maj_le timestamptz not null default now()
);

create index positions_ouvertes_idx on public.positions (portefeuille_id)
  where statut = 'OUVERTE';
create index positions_symbole_idx on public.positions (symbole_id, ouvert_le desc);

create trigger positions_maj before update on public.positions
  for each row execute function public.maj_horodatage();

-- Grand livre : toute variation de solde passe ici, avec le solde résultant.
-- C'est la source de vérité comptable, les autres tables en découlent.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  portefeuille_id uuid not null references public.portefeuilles (id) on delete cascade,
  position_id uuid references public.positions (id) on delete set null,
  ordre_id uuid references public.ordres (id) on delete set null,
  type public.type_transaction not null,
  montant numeric(20, 8) not null,
  solde_apres numeric(20, 8) not null,
  description text,
  cree_le timestamptz not null default now()
);

create index transactions_portefeuille_idx on public.transactions (portefeuille_id, cree_le desc);

-- Un instantané par jour et par portefeuille : c'est ce qui alimente la courbe
-- d'équité sans avoir à rejouer tout le grand livre.
create table public.instantanes_portefeuille (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  portefeuille_id uuid not null references public.portefeuilles (id) on delete cascade,
  jour date not null,
  equite numeric(20, 8) not null,
  solde numeric(20, 8) not null,
  pnl_jour numeric(20, 8) not null default 0,
  drawdown_pct numeric(8, 4) not null default 0,
  positions_ouvertes integer not null default 0,
  cree_le timestamptz not null default now(),
  unique (portefeuille_id, jour)
);
