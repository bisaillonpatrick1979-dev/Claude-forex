-- Enveloppe confiée aux agents.
--
-- Le propriétaire de la firme a 100 000 en banque et n'en confie que 10 000 :
-- les agents doivent alors dimensionner sur 10 000, pas sur 100 000. Sans
-- cela, « 1 % de risque par trade » vaut 1 000 alors que l'utilisateur croyait
-- en risquer 100.
--
-- L'enveloppe n'est pas un sous-compte comptable : la marge, le solde et
-- l'équité restent ceux du portefeuille unique. C'est un plafond d'engagement
-- appliqué aux décisions d'agents, et une base de calcul pour leurs
-- pourcentages. La distinction est assumée et documentée dans NOTES.md.

alter table public.portefeuilles
  add column if not exists capital_alloue_agents numeric(20, 2) not null default 0;

alter table public.portefeuilles
  add constraint portefeuilles_allocation_positive
  check (capital_alloue_agents >= 0);

-- Origine d'une position : c'est ce qui permet d'afficher séparément le
-- résultat des agents et celui des ordres passés à la main. Déduire l'origine
-- par jointure sur proposition_id fonctionnerait, mais coûterait deux jointures
-- sur chaque écran de performance.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'origine_position') then
    create type public.origine_position as enum ('MANUEL', 'AGENT');
  end if;
end
$$;

alter table public.positions
  add column if not exists origine public.origine_position not null default 'MANUEL';

alter table public.ordres
  add column if not exists origine public.origine_position not null default 'MANUEL';

create index if not exists positions_origine_idx on public.positions (profil_id, origine, statut);

-- Rattrapage : toute position déjà née d'une proposition vient d'un agent.
update public.positions p
set origine = 'AGENT'
from public.ordres o
where p.ordre_ouverture_id = o.id and o.proposition_id is not null and p.origine = 'MANUEL';

update public.ordres set origine = 'AGENT' where proposition_id is not null and origine = 'MANUEL';

-- Le cycle d'où sort une proposition, pour relier le fil de discussion à
-- l'ordre qui en est issu.
alter table public.propositions_ordres
  add column if not exists declenchee_par text;
