-- Annotations de graphique : les traits que le trader pose lui-même.
--
-- Ce qui rend cette table différente de la fonction équivalente d'une
-- plateforme commerciale : elle n'est pas seulement lue par le rendu. Les
-- annotations entrent dans l'instantané remis aux agents. Un trait posé sur une
-- résistance devient une phrase que les analystes doivent prendre en compte —
-- la confirmer ou la contredire, avec un motif.
--
-- `points` est du JSON et non des colonnes : les outils n'ont pas tous la même
-- arité (un niveau horizontal a un point, un Fibonacci en a deux), et un schéma
-- à colonnes fixes obligerait soit à laisser des NULL porteurs de sens, soit à
-- créer une table par outil. La contrainte CHECK vérifie l'arité réelle plutôt
-- que de faire confiance à l'application.

create table if not exists public.annotations_graphique (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  symbole text not null,
  -- NULL = visible sur toutes les unités de temps. Une résistance journalière
  -- ne cesse pas d'exister parce qu'on regarde le M5.
  intervalle text,
  outil text not null check (
    outil in ('NIVEAU', 'TENDANCE', 'FIBONACCI', 'FIBONACCI_EXTENSION', 'ZONE', 'NOTE')
  ),
  points jsonb not null,
  couleur text not null default '#4c9aff' check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  libelle text check (libelle is null or length(libelle) <= 120),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),

  -- Arité vérifiée en base : un Fibonacci à un seul point produirait un tracé
  -- vide côté rendu et une phrase « incomplet » côté agents. Autant le refuser.
  constraint annotations_points_valides check (
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) = case
      when outil in ('NIVEAU', 'NOTE') then 1
      else 2
    end
  )
);

create index if not exists annotations_graphique_profil_symbole_idx
  on public.annotations_graphique (profil_id, symbole);

alter table public.annotations_graphique enable row level security;

drop policy if exists "annotations lisibles" on public.annotations_graphique;
create policy "annotations lisibles" on public.annotations_graphique
  for select to authenticated using (profil_id = (select auth.uid()));

drop policy if exists "annotations insérables" on public.annotations_graphique;
create policy "annotations insérables" on public.annotations_graphique
  for insert to authenticated with check (profil_id = (select auth.uid()));

drop policy if exists "annotations modifiables" on public.annotations_graphique;
create policy "annotations modifiables" on public.annotations_graphique
  for update to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));

drop policy if exists "annotations supprimables" on public.annotations_graphique;
create policy "annotations supprimables" on public.annotations_graphique
  for delete to authenticated using (profil_id = (select auth.uid()));

comment on table public.annotations_graphique is
  'Traits posés par le trader sur le graphique. Lus par le rendu ET par les '
  'agents : chaque annotation est traduite en une phrase remise dans '
  'l''instantané, comme hypothèse humaine à confirmer ou à contredire.';
