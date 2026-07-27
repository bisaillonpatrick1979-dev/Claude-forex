-- Fuseau du profil : où commence une journée de trading.
--
-- Trois plafonds se réarment « chaque jour » — le budget d'appels aux modèles,
-- le nombre de trades par agent, et la perte journalière. Tant que la journée
-- était celle de l'UTC, ils se remettaient à zéro à 18 h heure de l'Alberta :
-- en pleine séance de New York, qui court jusqu'à 14 h locales. Un plafond
-- journalier qui se réarme au milieu de la journée de travail n'en est pas un.
--
-- Le fuseau est stocké par profil et non déduit du navigateur : les cycles
-- tournent aussi sans navigateur, depuis un cron. Deux sources de vérité pour
-- la même question finiraient par donner deux réponses.
--
-- Défaut volontairement 'UTC' : la migration ne change le comportement de
-- personne par surprise. Seul le profil existant, dont le propriétaire vit en
-- Alberta, est déplacé explicitement.

alter table public.profils
  add column if not exists fuseau_horaire text not null default 'UTC';

comment on column public.profils.fuseau_horaire is
  'Identifiant IANA (ex. America/Edmonton). Détermine où commence la journée '
  'pour le budget IA, le quota de trades par agent et la perte journalière.';

update public.profils set fuseau_horaire = 'America/Edmonton' where fuseau_horaire = 'UTC';

-- La table d'instantanés existait depuis l'origine, avec sa contrainte
-- d'unicité (portefeuille_id, jour), mais aucun code ne l'écrivait. Elle
-- devient le repère d'équité d'ouverture : sans lui, `equiteDebutJournee`
-- recevait l'équité courante, la perte du jour valait toujours zéro, et le
-- plafond de perte journalière ne pouvait pas se déclencher.
comment on table public.instantanes_portefeuille is
  'Un enregistrement par jour local et par portefeuille. La ligne est créée à '
  'la première évaluation d''ordre de la journée et sert de repère d''équité '
  'd''ouverture pour le contrôle de perte journalière.';

-- Les instantanés sont écrits par le serveur avec la clé de service ; la
-- lecture par le navigateur était déjà autorisée. On ajoute l'insertion pour
-- que le repère puisse être créé depuis une action serveur agissant sous la
-- session de l'utilisateur.
drop policy if exists "instantanés insérables" on public.instantanes_portefeuille;
create policy "instantanés insérables" on public.instantanes_portefeuille
  for insert to authenticated
  with check (profil_id = (select auth.uid()));
