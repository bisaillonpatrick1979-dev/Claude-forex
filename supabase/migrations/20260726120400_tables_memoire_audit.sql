-- Mémoire de la firme (pgvector), comptabilité des appels LLM, backtests,
-- journal d'audit immuable.

-- Une leçon est écrite par l'agent de réflexion après chaque position fermée.
-- Elle est réinjectée par similarité vectorielle dans les cycles suivants sur
-- le même symbole. Sans ça, les agents répètent éternellement les mêmes erreurs.
create table public.lecons (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  symbole_id uuid references public.symboles (id) on delete set null,
  position_id uuid references public.positions (id) on delete set null,
  cycle_id uuid references public.cycles (id) on delete set null,
  titre text not null,
  contenu text not null,
  etiquettes text[] not null default '{}',
  -- 1536 dimensions : compatible text-embedding-3-small (OpenAI) et
  -- voyage-3-lite. Changer de modèle d'embedding impose une migration de
  -- colonne, donc ce choix est verrouillé ici et documenté dans NOTES.md.
  embedding extensions.vector(1536),
  resultat_pnl numeric(20, 8),
  cree_le timestamptz not null default now()
);

create index lecons_symbole_idx on public.lecons (symbole_id, cree_le desc);

-- IVFFlat plutôt que HNSW : le volume de leçons restera petit (des centaines),
-- et IVFFlat consomme beaucoup moins de mémoire sur le palier gratuit.
create index lecons_embedding_idx on public.lecons
  using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

-- Comptabilité fine de chaque appel LLM : c'est la seule façon d'appliquer un
-- plafond de coût quotidien qui soit vrai.
create table public.appels_llm (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  cycle_id uuid references public.cycles (id) on delete set null,
  agent_id uuid references public.agents (id) on delete set null,
  fournisseur public.fournisseur_llm not null,
  modele text not null,
  tokens_entree integer not null default 0,
  tokens_sortie integer not null default 0,
  cout_usd numeric(12, 6) not null default 0,
  latence_ms integer,
  succes boolean not null default true,
  erreur text,
  cree_le timestamptz not null default now()
);

create index appels_llm_profil_jour_idx on public.appels_llm (profil_id, cree_le desc);
create index appels_llm_cycle_idx on public.appels_llm (cycle_id);

create table public.backtests (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  symbole_id uuid not null references public.symboles (id) on delete restrict,
  intervalle public.intervalle not null,
  debut timestamptz not null,
  fin timestamptz not null,
  capital_initial numeric(20, 8) not null,
  configuration jsonb not null default '{}'::jsonb,
  statut public.statut_backtest not null default 'EN_ATTENTE',
  -- Métriques mesurées : rendement, Sharpe, Sortino, drawdown max, taux de
  -- réussite, facteur de profit, nombre de trades.
  metriques jsonb,
  -- Références obligatoires : buy & hold et stratégie aléatoire de même
  -- fréquence. Affichées à côté du résultat, même quand elles sont meilleures.
  comparateurs jsonb,
  courbe_equite jsonb,
  erreur text,
  cree_le timestamptz not null default now(),
  termine_le timestamptz
);

create index backtests_profil_idx on public.backtests (profil_id, cree_le desc);

-- Journal d'audit : append-only. Toute action affectant le portefeuille ou la
-- configuration de risque y laisse une trace non modifiable.
create table public.journal_audit (
  id bigint generated always as identity primary key,
  profil_id uuid references public.profils (id) on delete set null,
  acteur text not null,
  action text not null,
  entite text,
  entite_id text,
  details jsonb not null default '{}'::jsonb,
  cree_le timestamptz not null default now()
);

create index journal_audit_profil_idx on public.journal_audit (profil_id, cree_le desc);

create or replace function public.journal_audit_immuable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Le journal d''audit est immuable (tentative de %).', tg_op;
end;
$$;

create trigger journal_audit_pas_de_maj
  before update or delete on public.journal_audit
  for each row execute function public.journal_audit_immuable();
