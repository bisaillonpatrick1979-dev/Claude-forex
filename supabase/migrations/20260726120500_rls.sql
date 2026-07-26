-- Politiques RLS.
--
-- Deux postures :
--   1. Tables de configuration (profil, agents, mandats, risque, fournisseurs) :
--      le propriétaire lit et écrit depuis le navigateur.
--   2. Tables comptables et de production des agents (portefeuille, ordres,
--      positions, transactions, cycles, messages…) : le propriétaire lit
--      seulement. Toute écriture passe par du code serveur avec la clé
--      service_role, qui contourne RLS. Un grand livre modifiable depuis le
--      navigateur ne vaut rien.
--
-- (select auth.uid()) plutôt que auth.uid() : le sous-select est évalué une
-- seule fois par requête au lieu d'une fois par ligne.

alter table public.profils enable row level security;
alter table public.parametres_risque enable row level security;
alter table public.agents enable row level security;
alter table public.mandats_agents enable row level security;
alter table public.portefeuilles enable row level security;
alter table public.symboles enable row level security;
alter table public.correspondances_symboles enable row level security;
alter table public.chandeliers enable row level security;
alter table public.fournisseurs_donnees enable row level security;
alter table public.cles_api enable row level security;
alter table public.cycles enable row level security;
alter table public.messages_agents enable row level security;
alter table public.rapports_analyse enable row level security;
alter table public.vues_marche enable row level security;
alter table public.propositions_ordres enable row level security;
alter table public.decisions_risque enable row level security;
alter table public.ordres enable row level security;
alter table public.positions enable row level security;
alter table public.transactions enable row level security;
alter table public.instantanes_portefeuille enable row level security;
alter table public.lecons enable row level security;
alter table public.appels_llm enable row level security;
alter table public.backtests enable row level security;
alter table public.journal_audit enable row level security;

-- --- Posture 1 : configuration, lecture + écriture par le propriétaire -------

create policy "profil lisible par son propriétaire"
  on public.profils for select to authenticated
  using (id = (select auth.uid()));

create policy "profil modifiable par son propriétaire"
  on public.profils for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "risque lisible" on public.parametres_risque for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "risque modifiable" on public.parametres_risque for update to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));

create policy "agents lisibles" on public.agents for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "agents modifiables" on public.agents for update to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));
create policy "agents creables" on public.agents for insert to authenticated
  with check (profil_id = (select auth.uid()));

create policy "mandats lisibles" on public.mandats_agents for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "mandats creables" on public.mandats_agents for insert to authenticated
  with check (profil_id = (select auth.uid()));
create policy "mandats modifiables" on public.mandats_agents for update to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));

create policy "fournisseurs lisibles" on public.fournisseurs_donnees for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "fournisseurs modifiables" on public.fournisseurs_donnees for update to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));
create policy "fournisseurs creables" on public.fournisseurs_donnees for insert to authenticated
  with check (profil_id = (select auth.uid()));

-- --- Référentiel partagé : lecture pour tous, écriture service_role ---------

create policy "symboles lisibles" on public.symboles for select to authenticated using (true);
create policy "correspondances lisibles" on public.correspondances_symboles for select to authenticated using (true);
create policy "chandeliers lisibles" on public.chandeliers for select to authenticated using (true);

-- --- Posture 2 : lecture seule côté navigateur ------------------------------

create policy "portefeuilles lisibles" on public.portefeuilles for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "cycles lisibles" on public.cycles for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "messages lisibles" on public.messages_agents for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "rapports lisibles" on public.rapports_analyse for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "vues de marché lisibles" on public.vues_marche for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "propositions lisibles" on public.propositions_ordres for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "décisions de risque lisibles" on public.decisions_risque for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "ordres lisibles" on public.ordres for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "positions lisibles" on public.positions for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "transactions lisibles" on public.transactions for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "instantanés lisibles" on public.instantanes_portefeuille for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "leçons lisibles" on public.lecons for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "appels LLM lisibles" on public.appels_llm for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "backtests lisibles" on public.backtests for select to authenticated
  using (profil_id = (select auth.uid()));
create policy "journal d'audit lisible" on public.journal_audit for select to authenticated
  using (profil_id = (select auth.uid()));

-- cles_api : aucune policy, volontairement. Seul service_role y accède.
