-- Recherche de playbooks filtrée par horizon de trading.
--
-- Rapatriée depuis la base : appliquée sans être versionnée.
--
-- Un playbook de scalping servi à un agent qui raisonne en swing est pire
-- qu'aucun playbook : il légitime une entrée dont l'horizon ne correspond pas
-- aux coûts supportés. Un tableau d'horizons vide reste servi à tous — c'est
-- la même convention que le périmètre d'instruments et les séances.

drop function if exists public.rechercher_strategies(extensions.vector, text, text, integer, uuid);

create or replace function public.rechercher_strategies(
  p_embedding extensions.vector(1536),
  p_methode text,
  p_famille text default null,
  p_limite integer default 3,
  p_profil_id uuid default null,
  p_horizon public.horizon_trading default null
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
    and (
      p_horizon is null
      or cardinality(s.horizons_trading) = 0
      or p_horizon = any (s.horizons_trading)
    )
  order by s.embedding <=> p_embedding
  limit greatest(1, least(p_limite, 10));
$fn$;

revoke execute on function public.rechercher_strategies(extensions.vector, text, text, integer, uuid, public.horizon_trading) from public, anon;
grant execute on function public.rechercher_strategies(extensions.vector, text, text, integer, uuid, public.horizon_trading) to authenticated, service_role;
