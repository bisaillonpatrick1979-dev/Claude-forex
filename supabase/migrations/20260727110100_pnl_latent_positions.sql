-- Résultat latent par position ouverte.
--
-- Le moteur le calcule déjà à chaque bougie pour réévaluer l'équité, mais ne
-- le conservait nulle part : impossible dès lors de dire combien les agents
-- ont gagné ou perdu séparément de l'utilisateur, puisque l'équité globale est
-- un total unique.
--
-- La valeur vaut au dernier horodatage traité par le moteur, pas à l'instant
-- de l'affichage. C'est dit dans l'interface plutôt que laissé à supposer.

alter table public.positions
  add column if not exists pnl_latent numeric(20, 2) not null default 0;

comment on column public.positions.pnl_latent is
  'Résultat non réalisé au dernier horodatage traité par le moteur. Nul sur une position fermée.';
