-- Couche de données de marché : référentiel d'instruments, correspondances de
-- symboles entre fournisseurs, cache de chandeliers, état des quotas.

-- Référentiel partagé (lecture pour tous les authentifiés, écriture service_role).
-- On y met tout ce dont le moteur d'exécution a besoin pour être réaliste :
-- spread par défaut, commission, swap, horaires de séance.
create table public.symboles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  libelle text not null,
  classe_actif public.classe_actif not null,
  devise_base text,
  devise_cotation text not null default 'USD',
  taille_contrat numeric(20, 8) not null default 1,
  pas_cotation numeric(20, 10) not null default 0.00001,
  decimales integer not null default 5,
  spread_defaut_points numeric(12, 4) not null default 1,
  commission_par_unite numeric(20, 8) not null default 0,
  swap_long_points numeric(12, 4) not null default 0,
  swap_court_points numeric(12, 4) not null default 0,
  levier_max numeric(6, 2) not null default 10,
  fuseau_seance text not null default 'UTC',
  -- Horaires par jour de semaine en UTC, ex. {"1": [["00:00","23:59"]]}.
  -- Le moteur d'exécution refuse de remplir hors séance.
  horaires_seance jsonb not null default '{}'::jsonb,
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

create index symboles_classe_idx on public.symboles (classe_actif) where actif;

-- Chaque fournisseur nomme les instruments à sa façon : EURUSD ↔ EUR/USD ↔ EURUSD=X.
-- Aucun adaptateur n'a le droit de deviner : il lit cette table.
create table public.correspondances_symboles (
  id uuid primary key default gen_random_uuid(),
  symbole_id uuid not null references public.symboles (id) on delete cascade,
  fournisseur_code text not null,
  symbole_externe text not null,
  unique (symbole_id, fournisseur_code)
);

create index correspondances_fournisseur_idx
  on public.correspondances_symboles (fournisseur_code, symbole_externe);

-- Cache de chandeliers. Clé naturelle (symbole, intervalle, horodatage) : une
-- bougie historique fermée n'est jamais redemandée. perime_le porte le TTL par
-- intervalle ; au-delà, la donnée reste servie mais marquée périmée dans l'UI.
create table public.chandeliers (
  symbole_id uuid not null references public.symboles (id) on delete cascade,
  intervalle public.intervalle not null,
  horodatage timestamptz not null,
  ouverture numeric(20, 8) not null,
  haut numeric(20, 8) not null,
  bas numeric(20, 8) not null,
  cloture numeric(20, 8) not null,
  volume numeric(24, 8),
  fournisseur_code text not null,
  fermee boolean not null default true,
  recupere_le timestamptz not null default now(),
  perime_le timestamptz,
  primary key (symbole_id, intervalle, horodatage)
);

create index chandeliers_recents_idx
  on public.chandeliers (symbole_id, intervalle, horodatage desc);

-- État opérationnel d'un fournisseur pour un profil donné : quota consommé,
-- dernière erreur, priorité par classe d'actifs. Le routeur lit cette table
-- avant tout appel et refuse d'appeler un fournisseur épuisé.
create table public.fournisseurs_donnees (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  code text not null,
  nom text not null,
  actif boolean not null default false,
  quota_limite integer,
  fenetre_quota public.fenetre_quota not null default 'JOUR',
  quota_utilise integer not null default 0,
  quota_reinitialise_le timestamptz not null default now(),
  -- Priorité par classe d'actifs, ex. {"FOREX": 1, "ACTION": 3}.
  -- Plus petit = essayé en premier. Absent = fournisseur non éligible.
  priorite_par_classe jsonb not null default '{}'::jsonb,
  dernier_statut text,
  derniere_erreur text,
  derniere_verification_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (profil_id, code)
);

create trigger fournisseurs_donnees_maj before update on public.fournisseurs_donnees
  for each row execute function public.maj_horodatage();

-- Clés API chiffrées au repos (AES-256-GCM côté serveur, clé dans
-- CLE_CHIFFREMENT). Aucune policy RLS n'est créée pour cette table : seul le
-- rôle service_role peut la lire, donc jamais le navigateur.
create table public.cles_api (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  service text not null,
  etiquette text,
  valeur_chiffree text not null,
  -- 4 derniers caractères en clair, pour que l'UI puisse afficher « ••••1234 ».
  indice_visuel text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (profil_id, service)
);

create trigger cles_api_maj before update on public.cles_api
  for each row execute function public.maj_horodatage();

-- Aucune vue publique sur cette table, même filtrée : la page Réglages lit les
-- métadonnées (service, indice visuel) via un composant serveur utilisant la
-- clé service_role, et ne renvoie au navigateur que ce qui est affichable.
revoke all on public.cles_api from anon, authenticated;
