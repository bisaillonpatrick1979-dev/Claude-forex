-- Alertes de niveau et journal des franchissements.
--
-- ⚠ Migration de rattrapage. Ces objets ont d'abord été créés directement sur
-- le projet distant, hors du dépôt. Ce fichier reconstitue leur définition à
-- l'identique, sous le numéro de version réellement appliqué, pour qu'un
-- déploiement neuf produise le même schéma. Il est idempotent : le rejouer sur
-- une base où les tables existent déjà ne fait rien.
--
-- ── Pourquoi trois états et une zone morte ─────────────────────────────────
--
-- Comparer le prix au niveau ne suffit pas : si le cours est au-dessus, l'a-t-il
-- franchi à l'instant ou depuis trois jours ? Il faut mémoriser de quel côté il
-- était. Mais deux côtés ne suffisent pas non plus — un cours qui vibre sur le
-- niveau bascule à chaque tick et l'alerte sonne vingt fois pour un seul
-- événement. D'où `dedans`, la bande neutre : il faut la traverser entièrement
-- pour changer de côté.
--
-- `dernier_cote` est NULL à la création, et c'est voulu : sans côté connu il
-- n'y a pas de trajet, donc pas de franchissement. Armer une alerte au-dessus
-- du cours ne la fait pas sonner immédiatement.

create table if not exists public.alertes_prix (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  symbole text not null,
  intervalle text not null default '1min',
  -- L'alerte survit à la suppression de son tracé : le niveau reste pertinent
  -- même si le trait qui l'a inspirée disparaît.
  annotation_id uuid references public.annotations_graphique (id) on delete set null,
  -- Recopié plutôt que joint : le libellé doit rester lisible dans un message
  -- de franchissement même après suppression du tracé d'origine.
  libelle_annotation text,
  niveau numeric not null,
  zone_morte numeric not null check (zone_morte >= 0),
  direction text not null default 'les_deux'
    check (direction in ('haussier', 'baissier', 'les_deux')),
  dernier_cote text check (dernier_cote in ('dessus', 'dessous', 'dedans')),
  dernier_prix numeric,
  verifie_le timestamptz,
  active boolean not null default true,
  usage_unique boolean not null default false,
  note text,
  cree_le timestamptz not null default now()
);

create table if not exists public.evenements_alerte (
  id uuid primary key default gen_random_uuid(),
  alerte_id uuid not null references public.alertes_prix (id) on delete cascade,
  profil_id uuid not null references public.profils (id) on delete cascade,
  symbole text not null,
  annotation_id uuid,
  libelle_annotation text,
  niveau numeric not null,
  prix numeric not null,
  direction text not null check (direction in ('haussier', 'baissier')),
  -- Un franchissement est remis une seule fois aux agents : sans ce drapeau,
  -- chaque cycle relirait les mêmes événements et raisonnerait en boucle sur
  -- un mouvement déjà digéré.
  consomme_par_agents boolean not null default false,
  declenche_le timestamptz not null default now()
);

create index if not exists alertes_prix_actives_idx
  on public.alertes_prix (profil_id, symbole) where active;

create index if not exists evenements_alerte_a_consommer_idx
  on public.evenements_alerte (profil_id, symbole) where not consomme_par_agents;

alter table public.alertes_prix enable row level security;
alter table public.evenements_alerte enable row level security;

drop policy if exists "alertes lisibles" on public.alertes_prix;
create policy "alertes lisibles" on public.alertes_prix
  for select to authenticated using (profil_id = (select auth.uid()));

drop policy if exists "alertes insérables" on public.alertes_prix;
create policy "alertes insérables" on public.alertes_prix
  for insert to authenticated with check (profil_id = (select auth.uid()));

drop policy if exists "alertes modifiables" on public.alertes_prix;
create policy "alertes modifiables" on public.alertes_prix
  for update to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));

drop policy if exists "alertes supprimables" on public.alertes_prix;
create policy "alertes supprimables" on public.alertes_prix
  for delete to authenticated using (profil_id = (select auth.uid()));

drop policy if exists "événements lisibles" on public.evenements_alerte;
create policy "événements lisibles" on public.evenements_alerte
  for select to authenticated using (profil_id = (select auth.uid()));

-- L'écriture des événements est réservée au serveur (clé de service) : un
-- franchissement est un constat, pas quelque chose que le navigateur déclare.

comment on table public.alertes_prix is
  'Alertes de franchissement de niveau. Surveillées par la fonction Edge '
  '« surveillance-alertes », appelée par pg_cron.';

comment on column public.alertes_prix.dernier_cote is
  'Côté du niveau à la dernière observation. NULL tant qu''aucune observation '
  'n''a eu lieu : sans point de départ, aucun franchissement n''est possible.';

comment on column public.alertes_prix.zone_morte is
  'Demi-largeur de la bande neutre autour du niveau. Absorbe le bruit : un '
  'cours qui vibre sur le niveau reste « dedans » et ne déclenche rien.';
