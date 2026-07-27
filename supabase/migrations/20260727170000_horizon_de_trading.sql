-- Horizon de trading : scalping, intraday, swing, position.
--
-- Ce ne sont pas quatre styles au choix du goût mais quatre régimes de
-- contraintes. Ce qui les sépare n'est pas la durée, c'est le rapport entre le
-- mouvement visé et le coût de l'aller-retour — d'où un contrôle de viabilité
-- côté application, qui refuse un horizon là où les frais mangent le gain.
--
-- La firme en choisit un ; les agents connaissent les quatre et doivent
-- pouvoir dire « ce signal serait bon en swing, il ne l'est pas ici ».

create type public.horizon_trading as enum ('SCALPING', 'INTRADAY', 'SWING', 'POSITION');

alter table public.profils
  add column if not exists horizon_trading public.horizon_trading not null default 'INTRADAY';

comment on column public.profils.horizon_trading is
  'Style pratiqué par la firme. Les agents connaissent les quatre ; celui-ci decide lequel ils appliquent.';

alter table public.strategies
  add column if not exists horizons_trading public.horizon_trading[] not null default '{}';

comment on column public.strategies.horizons_trading is
  'Horizons ou ce playbook a un sens. Vide = tous.';

-- Un playbook de retour à la moyenne sur quinze minutes n'a rien à dire à un
-- trader de position : servir les mauvais playbooks vaut à peine mieux que de
-- n'en servir aucun.
update public.strategies set horizons_trading = case famille
    when 'SCALPING' then array['SCALPING']::public.horizon_trading[]
    when 'CASSURE' then array['INTRADAY', 'SWING']::public.horizon_trading[]
    when 'RETOUR_MOYENNE' then array['SCALPING', 'INTRADAY']::public.horizon_trading[]
    when 'TENDANCE' then array['SWING', 'POSITION']::public.horizon_trading[]
    else array['SCALPING', 'INTRADAY', 'SWING', 'POSITION']::public.horizon_trading[]
  end
where cardinality(horizons_trading) = 0;

-- La recherche de playbooks filtre désormais sur l'horizon pratiqué. Un
-- playbook sans horizon déclaré vaut pour tous ; sinon il faut que l'horizon
-- actif y figure.
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
