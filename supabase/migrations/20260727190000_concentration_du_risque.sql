-- Remplacement du compteur de positions corrélées par une contrainte de
-- concentration continue.
--
-- Ce que faisait l'ancien réglage : compter les positions ouvertes dont la
-- corrélation estimée avec la position proposée dépassait `seuil_correlation`,
-- et refuser au-delà de `positions_correlees_max`. Deux trous :
--
--   * effet de falaise — trois positions à 0,69 sous un seuil de 0,70
--     comptaient pour zéro, soit trois fois le même pari approuvé sans réserve ;
--   * aveuglement aux chaînes — long EUR/USD, long GBP/USD et short USD/CHF
--     n'ont aucun couple au-dessus du seuil mais forment un seul pari short USD.
--
-- Les deux nouveaux réglages sont continus et n'ont donc pas de falaise :
--
--   * `part_position_max_pct` plafonne la part du risque agrégé qu'une seule
--     position peut porter (contribution marginale ÷ risque du portefeuille) ;
--   * `part_facteur_max_pct` plafonne l'exposition nette d'un facteur — devise
--     pour le Forex, classe d'actif sinon — en pourcentage du budget de risque
--     total. C'est ce plafond qui attrape la chaîne short USD.
--
-- Les anciennes colonnes sont supprimées plutôt que laissées en place : une
-- colonne nommée `positions_correlees_max` que plus aucun code n'applique est
-- exactement le genre d'artefact qui fait croire à une protection inexistante.
-- Elles ne contenaient que des réglages, jamais d'historique.

alter table public.parametres_risque
  add column if not exists part_position_max_pct numeric(5, 2) not null default 50.00,
  add column if not exists part_facteur_max_pct numeric(5, 2) not null default 50.00;

alter table public.parametres_risque
  drop constraint if exists parametres_risque_part_position_max_pct_check,
  add constraint parametres_risque_part_position_max_pct_check
    check (part_position_max_pct > 0 and part_position_max_pct <= 100);

alter table public.parametres_risque
  drop constraint if exists parametres_risque_part_facteur_max_pct_check,
  add constraint parametres_risque_part_facteur_max_pct_check
    check (part_facteur_max_pct > 0 and part_facteur_max_pct <= 100);

comment on column public.parametres_risque.part_position_max_pct is
  'Part maximale du risque agrégé qu''une seule position peut porter, en %. '
  'Ne s''applique qu''à partir de la deuxième position : une position seule '
  'porte 100 % du risque par définition.';

comment on column public.parametres_risque.part_facteur_max_pct is
  'Exposition nette maximale d''un facteur (devise ou classe d''actif), en % du '
  'budget de risque total. Remplace le compteur de positions corrélées.';

alter table public.parametres_risque
  drop column if exists positions_correlees_max,
  drop column if exists seuil_correlation;
