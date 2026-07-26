-- Confirmation automatique des adresses à l'inscription.
--
-- Équivalent en base du réglage « Confirm email » du tableau de bord Supabase.
-- Le réglage lui-même vit dans la configuration GoTrue, hors de portée d'une
-- migration ; ce trigger produit le même effet côté données. GoTrue enverra
-- peut-être encore un courriel de confirmation, mais le compte est utilisable
-- immédiatement et le lien devient superflu.
--
-- Contrepartie assumée : n'importe qui pouvant atteindre le déploiement peut
-- créer un compte avec une adresse qu'il ne possède pas. Acceptable pour une
-- application mono-utilisateur ; à revoir si elle s'ouvre à d'autres.

create or replace function public.confirmer_courriel_automatiquement()
returns trigger
language plpgsql
security definer
set search_path = auth, public
as $fn$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$fn$;

create trigger confirmation_automatique
  before insert on auth.users
  for each row execute function public.confirmer_courriel_automatiquement();

revoke execute on function public.confirmer_courriel_automatiquement() from public, anon, authenticated;

-- Rattrapage pour d'éventuels comptes déjà créés et restés non confirmés.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
