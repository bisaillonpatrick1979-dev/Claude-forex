-- Traçabilité de la méthode d'embedding.
--
-- Deux méthodes coexistent : « openai-3-small » (sémantique, exige une clé
-- OpenAI) et « lexical-1536 » (projection lexicale déterministe, calculée
-- localement, disponible sans aucune clé). Leurs espaces vectoriels n'ont
-- rien à voir : comparer une distance cosinus entre les deux produirait un
-- classement arbitraire présenté comme pertinent. On stocke donc la méthode
-- et on filtre dessus à la recherche.

alter table public.strategies add column if not exists methode_embedding text;
alter table public.lecons add column if not exists methode_embedding text;

create index if not exists strategies_methode_idx on public.strategies (methode_embedding);
create index if not exists lecons_methode_idx on public.lecons (methode_embedding);

drop function if exists public.rechercher_lecons(extensions.vector, uuid, integer);
drop function if exists public.rechercher_strategies(extensions.vector, text, integer);

create or replace function public.rechercher_lecons(
  p_embedding extensions.vector(1536),
  p_methode text,
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
    and l.methode_embedding = p_methode
    and (p_symbole_id is null or l.symbole_id = p_symbole_id)
  order by l.embedding <=> p_embedding
  limit greatest(1, least(p_limite, 20));
$fn$;

create or replace function public.rechercher_strategies(
  p_embedding extensions.vector(1536),
  p_methode text,
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
    and s.methode_embedding = p_methode
    and (p_famille is null or s.famille = p_famille)
  order by s.embedding <=> p_embedding
  limit greatest(1, least(p_limite, 10));
$fn$;

revoke execute on function public.rechercher_lecons(extensions.vector, text, uuid, integer) from public, anon;
revoke execute on function public.rechercher_strategies(extensions.vector, text, text, integer) from public, anon;
grant execute on function public.rechercher_lecons(extensions.vector, text, uuid, integer) to authenticated;
grant execute on function public.rechercher_strategies(extensions.vector, text, text, integer) to authenticated;
