-- Cadence d'observation adaptative.
--
-- La cadence fixe se trompait dans les deux sens à la fois. Toutes les cinq
-- minutes, c'est beaucoup trop souvent quand le cours est à deux cents points
-- du niveau — il ne peut physiquement pas y arriver entre deux observations —
-- et beaucoup trop rare quand il est collé dessus, là où le franchissement se
-- joue à la seconde.
--
-- On mesure donc le temps qu'il faudrait au cours pour atteindre le niveau, et
-- on observe quatre fois avant ce moment :
--
--     minutes pour atteindre ≈ distance / mouvement typique par minute
--     intervalle             = minutes pour atteindre ÷ 4,  borné [1 min, 30 min]
--
-- Le quota cesse d'être dépensé au hasard : il se concentre là où quelque chose
-- peut arriver. Un cours qui dérive loin de tout niveau coûte 48 appels par
-- jour ; un cours qui teste une résistance passe à la minute. La cadence fixe à
-- cinq minutes coûtait 288 appels quoi qu'il arrive — et manquait quand même le
-- test.
--
-- La logique est dans `src/lib/alertes/cadence.ts`, testée. La fonction Edge en
-- porte une copie : Deno ne partage pas le graphe de modules de Next.

alter table public.alertes_prix
  add column if not exists prochaine_observation_le timestamptz,
  add column if not exists volatilite_minute numeric;

comment on column public.alertes_prix.prochaine_observation_le is
  'Moment à partir duquel il vaut la peine de redemander le prix. NULL = à '
  'observer au prochain tour. Calculé depuis la distance au niveau et la '
  'volatilité récente.';

comment on column public.alertes_prix.volatilite_minute is
  'Amplitude typique du mouvement sur une minute, en prix, lissée par moyenne '
  'exponentielle sur les observations. Sert à estimer le temps de parcours '
  'jusqu''au niveau — ce n''est pas une prédiction de direction.';

-- Les alertes existantes sont observées au prochain tour : sans cela, une
-- colonne NULL les exclurait ou les figerait selon le sens du filtre.
update public.alertes_prix set prochaine_observation_le = null where active;

create index if not exists alertes_prix_a_observer_idx
  on public.alertes_prix (profil_id, symbole, prochaine_observation_le)
  where active;
