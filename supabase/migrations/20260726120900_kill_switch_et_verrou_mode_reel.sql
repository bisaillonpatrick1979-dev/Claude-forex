-- Verrou du mode réel au niveau de la base.
-- Le drapeau serveur TypeScript est la première barrière ; celle-ci est la
-- dernière. Comme la policy RLS autorise le propriétaire à modifier son profil
-- depuis le navigateur, un simple contrôle applicatif serait contournable.
-- Lever ce verrou est un acte explicite de la phase 7 : une migration qui
-- remplace cette fonction.
create or replace function public.refuser_mode_reel()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.mode_operation::text like 'REEL%' then
    raise exception 'Le mode réel est désactivé au niveau de la base (phase 7).';
  end if;
  return new;
end;
$fn$;

create or replace function public.refuser_mode_reel_portefeuille()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.mode::text like 'REEL%' then
    raise exception 'Le mode réel est désactivé au niveau de la base (phase 7).';
  end if;
  return new;
end;
$fn$;

create trigger profils_verrou_mode_reel
  before insert or update on public.profils
  for each row execute function public.refuser_mode_reel();

create trigger portefeuilles_verrou_mode_reel
  before insert or update on public.portefeuilles
  for each row execute function public.refuser_mode_reel_portefeuille();

-- Kill switch : gèle les portefeuilles, désactive les agents, annule les
-- propositions en attente. SECURITY DEFINER parce que les tables comptables
-- sont en lecture seule pour le navigateur — c'est le seul chemin d'écriture
-- accordé au client, et il est étroit, journalisé et sans paramètre libre.
create or replace function public.declencher_kill_switch(p_raison text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profil uuid := auth.uid();
  v_raison text := coalesce(nullif(trim(p_raison), ''), 'Kill switch déclenché manuellement');
begin
  if v_profil is null then
    raise exception 'Authentification requise.';
  end if;

  update public.portefeuilles
     set gele = true, raison_gel = v_raison, gele_le = now()
   where profil_id = v_profil and not gele;

  update public.agents set actif = false where profil_id = v_profil and actif;

  update public.propositions_ordres
     set statut = 'EXPIREE', decide_le = now()
   where profil_id = v_profil
     and statut in ('PROPOSEE', 'EN_CONTROLE_RISQUE', 'EN_ATTENTE_VALIDATION');

  update public.ordres
     set statut = 'ANNULE', motif_fin = v_raison
   where profil_id = v_profil and statut in ('EN_ATTENTE', 'PARTIELLEMENT_REMPLI');

  update public.cycles
     set etat = 'ABANDONNE', termine_le = now(), erreur = v_raison
   where profil_id = v_profil
     and etat not in ('TERMINE', 'ECHOUE', 'ABANDONNE');

  insert into public.journal_audit (profil_id, acteur, action, entite, entite_id, details)
  values (v_profil, 'utilisateur', 'KILL_SWITCH', 'portefeuilles', null,
          jsonb_build_object('raison', v_raison));
end;
$fn$;

-- Le dégel est volontairement une action distincte : après un kill switch,
-- rien ne redémarre tout seul.
create or replace function public.lever_kill_switch()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profil uuid := auth.uid();
begin
  if v_profil is null then
    raise exception 'Authentification requise.';
  end if;

  update public.portefeuilles
     set gele = false, raison_gel = null, gele_le = null
   where profil_id = v_profil and gele;

  insert into public.journal_audit (profil_id, acteur, action, entite, entite_id)
  values (v_profil, 'utilisateur', 'LEVEE_KILL_SWITCH', 'portefeuilles', null);
end;
$fn$;

revoke execute on function public.declencher_kill_switch(text) from public, anon;
revoke execute on function public.lever_kill_switch() from public, anon;
grant execute on function public.declencher_kill_switch(text) to authenticated;
grant execute on function public.lever_kill_switch() to authenticated;
