-- Rejeu historique : faire défiler le marché à la vitesse choisie.
--
-- Le curseur vit sur le portefeuille et non dans une table à part : le moteur
-- d'exécution avance déjà en fonction de `dernier_horodatage_traite`, et
-- dupliquer l'horloge dans deux endroits garantirait qu'ils divergent.
--
-- `rejeu_actif` n'est pas décoratif : tant qu'il est vrai, le portefeuille
-- vit dans le passé, et afficher ses chiffres à côté de prix temps réel
-- n'aurait aucun sens. L'interface le signale en permanence.

alter table public.portefeuilles
  add column if not exists rejeu_actif boolean not null default false,
  add column if not exists rejeu_symbole text,
  add column if not exists rejeu_intervalle public.intervalle,
  add column if not exists rejeu_debut bigint,
  add column if not exists rejeu_curseur bigint,
  add column if not exists rejeu_fin bigint,
  add column if not exists rejeu_source text;

alter table public.portefeuilles
  add constraint portefeuilles_rejeu_source
  check (rejeu_source is null or rejeu_source in ('SIMULE', 'FOURNISSEUR'));

comment on column public.portefeuilles.rejeu_curseur is
  'Horodatage UTC (secondes) de la dernière bougie rejouée. Nul hors rejeu.';
