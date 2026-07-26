-- Bibliothèque de stratégies : des playbooks structurés, pas un corpus opaque.
-- Chaque entrée dit dans quelles conditions elle s'applique, ses règles
-- d'entrée et de sortie chiffrées, et surtout quand elle échoue — c'est cette
-- dernière partie qui manque à la plupart des « méthodes de trading ».
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  -- profil_id nul = playbook fourni avec l'application, partagé et non modifiable.
  profil_id uuid references public.profils (id) on delete cascade,
  code text not null,
  nom text not null,
  famille text not null,
  horizons public.intervalle[] not null default '{}',
  classes_actifs public.classe_actif[] not null default '{}',
  resume text not null,
  conditions_marche text not null,
  regles_entree text not null,
  regles_sortie text not null,
  gestion_taille text not null,
  cas_echec text not null,
  embedding extensions.vector(1536),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

create unique index strategies_code_idx on public.strategies (coalesce(profil_id::text, 'systeme'), code);
create index strategies_embedding_idx on public.strategies
  using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 20);

create trigger strategies_maj before update on public.strategies
  for each row execute function public.maj_horodatage();

alter table public.strategies enable row level security;

create policy "strategies lisibles" on public.strategies for select to authenticated
  using (profil_id is null or profil_id = (select auth.uid()));
create policy "strategies personnelles modifiables" on public.strategies for update to authenticated
  using (profil_id = (select auth.uid())) with check (profil_id = (select auth.uid()));
create policy "strategies personnelles creables" on public.strategies for insert to authenticated
  with check (profil_id = (select auth.uid()));

-- Style privilégié d'un agent : oriente la recherche de playbooks qui lui est
-- servie. Nul = tous les styles.
alter table public.agents add column if not exists famille_strategie text;

-- Recherche de similarité. Fonctions SECURITY DEFINER filtrant sur auth.uid() :
-- pgvector n'est pas exposé au client, et la portée reste celle du profil.
create or replace function public.rechercher_lecons(
  p_embedding extensions.vector(1536),
  p_symbole_id uuid default null,
  p_limite integer default 5
)
returns table (id uuid, titre text, contenu text, resultat_pnl numeric, distance double precision)
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select l.id, l.titre, l.contenu, l.resultat_pnl,
         (l.embedding <=> p_embedding)::double precision as distance
  from public.lecons l
  where l.profil_id = auth.uid()
    and l.embedding is not null
    and (p_symbole_id is null or l.symbole_id = p_symbole_id)
  order by l.embedding <=> p_embedding
  limit greatest(1, least(p_limite, 20));
$fn$;

create or replace function public.rechercher_strategies(
  p_embedding extensions.vector(1536),
  p_famille text default null,
  p_limite integer default 3
)
returns table (
  id uuid, code text, nom text, famille text, resume text,
  conditions_marche text, regles_entree text, regles_sortie text,
  gestion_taille text, cas_echec text, distance double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select s.id, s.code, s.nom, s.famille, s.resume,
         s.conditions_marche, s.regles_entree, s.regles_sortie,
         s.gestion_taille, s.cas_echec,
         (s.embedding <=> p_embedding)::double precision as distance
  from public.strategies s
  where s.actif
    and (s.profil_id is null or s.profil_id = auth.uid())
    and s.embedding is not null
    and (p_famille is null or s.famille = p_famille)
  order by s.embedding <=> p_embedding
  limit greatest(1, least(p_limite, 10));
$fn$;

revoke execute on function public.rechercher_lecons(extensions.vector, uuid, integer) from public, anon;
revoke execute on function public.rechercher_strategies(extensions.vector, text, integer) from public, anon;
grant execute on function public.rechercher_lecons(extensions.vector, uuid, integer) to authenticated;
grant execute on function public.rechercher_strategies(extensions.vector, text, integer) to authenticated;
