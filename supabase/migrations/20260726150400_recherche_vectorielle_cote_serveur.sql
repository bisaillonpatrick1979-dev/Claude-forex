-- L'orchestrateur tourne avec la clé de service : auth.uid() y vaut NULL, donc
-- les fonctions de recherche filtrées sur auth.uid() ne rendaient rien. On
-- ajoute un profil explicite, mais il n'est honoré que lorsque auth.uid() est
-- NULL — c'est-à-dire jamais pour un utilisateur connecté. Un client
-- authentifié ne peut donc pas lire la mémoire d'un autre profil en passant
-- son identifiant, et `anon` n'a de toute façon pas le droit d'exécution.

drop function if exists public.rechercher_lecons(extensions.vector, text, uuid, integer);
drop function if exists public.rechercher_strategies(extensions.vector, text, text, integer);

create or replace function public.rechercher_lecons(
  p_embedding extensions.vector(1536),
  p_methode text,
  p_symbole_id uuid default null,
  p_limite integer default 5,
  p_profil_id uuid default null
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
  where l.profil_id = coalesce(auth.uid(), p_profil_id)
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
  p_limite integer default 3,
  p_profil_id uuid default null
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
    and (s.profil_id is null or s.profil_id = coalesce(auth.uid(), p_profil_id))
    and s.embedding is not null
    and s.methode_embedding = p_methode
    and (p_famille is null or s.famille = p_famille)
  order by s.embedding <=> p_embedding
  limit greatest(1, least(p_limite, 10));
$fn$;

revoke execute on function public.rechercher_lecons(extensions.vector, text, uuid, integer, uuid) from public, anon;
revoke execute on function public.rechercher_strategies(extensions.vector, text, text, integer, uuid) from public, anon;
grant execute on function public.rechercher_lecons(extensions.vector, text, uuid, integer, uuid) to authenticated, service_role;
grant execute on function public.rechercher_strategies(extensions.vector, text, text, integer, uuid) to authenticated, service_role;
