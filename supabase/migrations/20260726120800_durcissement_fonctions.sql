-- Durcissement remonté par le linter Supabase :
-- search_path figé sur les fonctions de trigger (sinon un rôle peut détourner
-- la résolution de noms), et retrait du droit d'exécution sur la fonction
-- SECURITY DEFINER, qui serait autrement appelable via /rest/v1/rpc.
--
-- Note : cles_api reste volontairement « RLS activée sans policy » — c'est
-- l'effet recherché, seul service_role doit y accéder.

alter function public.maj_horodatage() set search_path = public;
alter function public.journal_audit_immuable() set search_path = public;

revoke execute on function public.initialiser_profil() from anon, authenticated, public;
