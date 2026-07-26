-- Dernière bougie déjà passée dans le moteur d'exécution, par portefeuille.
-- Sans ce repère, relancer le traitement rejouerait des bougies déjà
-- comptabilisées et dupliquerait remplissages et frais.

alter table public.portefeuilles
  add column if not exists dernier_horodatage_traite bigint;

comment on column public.portefeuilles.dernier_horodatage_traite is
  'Horodatage UTC (secondes) de la dernière bougie traitée par le moteur d''exécution.';
