-- Niveau d'effort par agent, et marge de tokens pour la réflexion.
--
-- Deux corrections liées, toutes deux nécessaires avant de brancher un modèle
-- réel.
--
-- 1. `effort` n'existait pas. C'est pourtant le levier de coût et de latence
--    des modèles récents : il pilote la profondeur de réflexion. Sans lui, tout
--    tourne au défaut `high`, ce qui est le bon réglage pour un gestionnaire de
--    portefeuille et un gaspillage pour un analyste qui résume un instantané.
--
-- 2. `tokens_max` valait 2000 pour les douze agents. Sur les modèles où la
--    réflexion est active par défaut, ce plafond couvre la réflexion **et** la
--    réponse : le bloc JSON final serait coupé en plein milieu, et l'extraction
--    échouerait sur une sortie qui n'a rien d'invalide — seulement tronquée.
--    C'est le genre de panne qu'on passerait une soirée à chercher dans le
--    schéma Zod.

alter table public.agents
  add column if not exists effort_llm text not null default 'medium'
    check (effort_llm in ('low', 'medium', 'high', 'xhigh', 'max'));

comment on column public.agents.effort_llm is
  'Profondeur de réflexion demandée au modèle. Ignoré par les fournisseurs qui ne la connaissent pas.';

-- Le plafond doit laisser respirer la réflexion. 2000 tokens suffisaient au
-- mock, qui ne réfléchit pas.
update public.agents set tokens_max = 8000 where tokens_max < 8000;

alter table public.agents alter column tokens_max set default 8000;

-- Attribution des modèles réels, rôle par rôle.
--
-- Le principe : la dépense suit l'enjeu. Deux rôles engagent réellement le
-- capital et reçoivent le meilleur modèle ; les analystes dont les données
-- tiennent déjà dans l'instantané reçoivent le moins cher, qui accepte encore
-- la température ; tout le reste passe par le palier intermédiaire, seul à
-- savoir utiliser les outils de recherche web récents — ce qui exclut Haiku
-- pour les rôles macro, sentiment et fondamental, dont la matière est hors du
-- graphique.
update public.agents set fournisseur_llm = 'anthropic', modele = case role
    when 'GESTIONNAIRE_PORTEFEUILLE' then 'claude-opus-5'
    when 'TRADER' then 'claude-opus-5'
    when 'ANALYSTE_TECHNIQUE' then 'claude-haiku-4-5'
    when 'ANALYSTE_VOLATILITE' then 'claude-haiku-4-5'
    when 'AGENT_REFLEXION' then 'claude-haiku-4-5'
    else 'claude-sonnet-5'
  end,
  effort_llm = case role
    when 'GESTIONNAIRE_PORTEFEUILLE' then 'high'
    when 'GESTIONNAIRE_RISQUE' then 'high'
    when 'TRADER' then 'medium'
    when 'DIRECTEUR_RECHERCHE' then 'medium'
    when 'CHERCHEUR_HAUSSIER' then 'medium'
    when 'CHERCHEUR_BAISSIER' then 'medium'
    else 'low'
  end
where modele = 'mock-1';
