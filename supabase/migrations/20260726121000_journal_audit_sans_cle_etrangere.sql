-- La contrainte « on delete set null » sur journal_audit.profil_id entrait en
-- conflit direct avec le trigger d'immuabilité : supprimer un compte déclenchait
-- un UPDATE sur le journal, donc une exception, donc une suppression impossible.
-- Découvert en testant la suppression d'un utilisateur, pas en relisant le SQL.
--
-- Un journal d'audit doit survivre à la disparition de ce qu'il décrit. On garde
-- donc l'identifiant comme simple uuid, sans clé étrangère. La policy RLS
-- (profil_id = auth.uid()) continue de fonctionner à l'identique.

alter table public.journal_audit
  drop constraint if exists journal_audit_profil_id_fkey;
