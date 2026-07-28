-- Deux fonctions de déclencheur restaient appelables en RPC.
--
-- `initialiser_permissions_agent` et `journaliser_permission_agent` sont
-- attachées à des triggers sur `agents` et `permissions_agents`. PostgreSQL les
-- exécute pour le compte du propriétaire de la table, sans passer par PostgREST
-- — leur retirer le droit d'exécution ne change donc rien au fonctionnement des
-- triggers.
--
-- Ce qui change, c'est qu'elles cessent d'être exposées comme des points
-- d'entrée `/rest/v1/rpc/…`. Les deux sont `SECURITY DEFINER` : appelées
-- directement, elles s'exécuteraient avec les droits du propriétaire du schéma,
-- hors de toute politique RLS. `initialiser_permissions_agent` était même
-- atteignable par le rôle `anon`, c'est-à-dire sans être connecté.
--
-- Aucune exploitation constatée : les deux lisent `new`, qui est nul hors
-- contexte de trigger, et échouent. Mais une fonction privilégiée exposée sans
-- raison est une surface à retirer, pas à surveiller. Même geste que pour
-- `initialiser_profil` en phase 0.

revoke execute on function public.initialiser_permissions_agent()
  from anon, authenticated, public;

revoke execute on function public.journaliser_permission_agent()
  from anon, authenticated, public;
