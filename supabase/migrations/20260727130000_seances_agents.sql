-- Séances de marché pendant lesquelles les agents ont le droit de travailler.
--
-- Le Forex ne ferme pas, mais il ne se comporte pas de la même façon à toute
-- heure : ouvrir une position à 3 h UTC, c'est trader dans un marché fin où le
-- spread s'élargit et où un stop se fait toucher par du bruit.
--
-- Tableau vide = aucune restriction. Même convention que le périmètre
-- d'instruments : l'inverser ici donnerait deux sémantiques à la même idée.

alter table public.profils
  add column if not exists seances_agents text[] not null default '{}';

comment on column public.profils.seances_agents is
  'Séances autorisées (SYDNEY, TOKYO, LONDRES, NEW_YORK). Vide = aucune restriction.';
