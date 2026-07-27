-- Couverture historique par instrument et par intervalle.
--
-- Rapatriée depuis la base : elle y était appliquée sans être versionnée, donc
-- le dépôt ne pouvait plus reconstruire le schéma déployé.
--
-- `security_invoker` est indispensable : sans lui, une vue s'exécute avec les
-- droits de son propriétaire et court-circuiterait les policies RLS de
-- `chandeliers`. Avec, elle hérite des droits de l'appelant.

create or replace view public.vue_couverture_historique
with (security_invoker = true) as
select
  c.symbole_id,
  s.code as symbole,
  s.classe_actif,
  c.intervalle,
  count(*)::bigint as bougies,
  min(c.horodatage) as premiere,
  max(c.horodatage) as derniere,
  max(c.recupere_le) as dernier_import
from public.chandeliers c
join public.symboles s on s.id = c.symbole_id
group by c.symbole_id, s.code, s.classe_actif, c.intervalle;

grant select on public.vue_couverture_historique to authenticated;
