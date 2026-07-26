-- Une proposition doit se rejouer telle qu'elle a été faite.
--
-- Le contrôle de risque est refait au moment de la validation, sur des prix
-- frais : sans l'intervalle d'origine, on rejouerait la décision sur une autre
-- unité de temps que celle qui l'a produite. Tant que la proposition naissait
-- forcément d'un cycle, l'information était portée par `cycles.intervalle` ;
-- depuis qu'une proposition peut naître hors cycle, elle doit la porter
-- elle-même.
alter table public.propositions_ordres
  add column if not exists intervalle public.intervalle;

comment on column public.propositions_ordres.intervalle is
  'Intervalle sur lequel la proposition a été construite. Sert au recontrôle de risque lors de la validation.';
