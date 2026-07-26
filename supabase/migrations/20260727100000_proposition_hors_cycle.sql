-- Préparation de la gouvernance des agents (phase 4a).
--
-- Deux changements sur l'existant, isolés dans leur propre migration parce que
-- `alter type ... add value` ne peut pas être suivi d'un usage de la nouvelle
-- valeur dans la même transaction.

-- Un refus de permission n'est pas un refus de risque : les deux barrières sont
-- distinctes et doivent rester distinguables dans l'historique. Sans cette
-- valeur, un agent recalé parce qu'il n'avait pas le droit d'ouvrir serait
-- archivé comme « rejeté par le risque », ce qui est faux.
alter type public.statut_proposition add value if not exists 'REFUSEE_PERMISSION';

-- Une proposition ne naît pas toujours dans un cycle de décision : le banc
-- d'essai des permissions et, plus tard, une action directe d'agent hors cycle
-- en produisent aussi. Le lien reste tracé quand il existe.
alter table public.propositions_ordres alter column cycle_id drop not null;
