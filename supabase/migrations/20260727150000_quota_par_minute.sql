-- Limite de débit par minute, en plus de la fenêtre principale.
--
-- Constaté en production : Twelve Data a répondu 429 avec douze requêtes
-- consommées sur huit cents. Ce n'était pas le quota journalier mais la limite
-- par minute du palier gratuit — huit requêtes. La veille balaie treize
-- instruments d'un coup et la dépasse en une rafale.
--
-- Le modèle n'avait qu'une fenêtre par fournisseur. C'était suffisant tant que
-- chacun n'en publiait qu'une, et faux dès que l'un des deux plafonds mord :
-- l'application se croyait à 1,5 % de son quota pendant que le fournisseur la
-- refusait.

alter table public.fournisseurs_donnees
  add column if not exists quota_minute_limite integer,
  add column if not exists quota_minute_utilise integer not null default 0,
  add column if not exists quota_minute_reinitialise_le timestamptz not null default now();

comment on column public.fournisseurs_donnees.quota_minute_limite is
  'Requêtes par minute tolérées. NULL = pas de limite de débit connue.';

-- Paliers gratuits, à la date d'écriture. À corriger si l'abonnement change.
update public.fournisseurs_donnees set quota_minute_limite = 8 where code = 'twelvedata';
update public.fournisseurs_donnees set quota_minute_limite = 5 where code = 'alphavantage';
update public.fournisseurs_donnees set quota_minute_limite = 60 where code = 'finnhub';
update public.fournisseurs_donnees set quota_minute_limite = 200 where code = 'alpaca';

/*
 * Réservation atomique d'un appel.
 *
 * L'ancien compteur lisait puis écrivait en deux requêtes, et l'assumait :
 * « deux appels concurrents peuvent en compter un seul ». Cette dérive est
 * anodine sur huit cents par jour et fatale sur huit par minute — il suffit de
 * deux instances servant la même rafale pour dépasser sans jamais le voir.
 *
 * D'où un SELECT ... FOR UPDATE suivi de l'incrément dans la même transaction.
 * La fonction réserve **avant** l'appel sortant, et non après son succès : un
 * appel refusé par le fournisseur compte quand même dans sa limite de débit.
 * Compter après coup laisserait chaque échec ouvrir la porte au suivant.
 *
 * Réservée à service_role : le routeur l'appelle avec le client à privilèges
 * et filtre explicitement sur profil_id, comme partout où RLS ne protège plus.
 */
create or replace function public.reserver_appel_fournisseur(
  p_profil_id uuid,
  p_code text,
  p_maintenant timestamptz default now()
)
returns table (autorise boolean, raison text, reprise_le timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_ligne public.fournisseurs_donnees%rowtype;
  v_debut_principal timestamptz;
  v_debut_minute timestamptz;
  v_utilise integer;
  v_utilise_minute integer;
begin
  select * into v_ligne
    from public.fournisseurs_donnees
   where profil_id = p_profil_id and code = p_code
     for update;

  if not found then
    return query select false, format('Fournisseur %s inconnu pour ce profil.', p_code), null::timestamptz;
    return;
  end if;

  v_debut_principal := case v_ligne.fenetre_quota
    when 'MINUTE' then date_trunc('minute', p_maintenant)
    when 'HEURE'  then date_trunc('hour', p_maintenant)
    when 'JOUR'   then date_trunc('day', p_maintenant)
    when 'MOIS'   then date_trunc('month', p_maintenant)
  end;
  v_debut_minute := date_trunc('minute', p_maintenant);

  -- Une fenêtre dont la borne est dépassée repart de zéro. On compare à la
  -- borne naturelle et non à un âge écoulé : c'est ainsi que les fournisseurs
  -- comptent, et se caler autrement décalerait la remise à zéro un peu plus
  -- chaque jour.
  v_utilise := case when v_ligne.quota_reinitialise_le < v_debut_principal
                    then 0 else v_ligne.quota_utilise end;
  v_utilise_minute := case when v_ligne.quota_minute_reinitialise_le < v_debut_minute
                           then 0 else v_ligne.quota_minute_utilise end;

  if v_ligne.quota_minute_limite is not null and v_utilise_minute >= v_ligne.quota_minute_limite then
    return query select
      false,
      format('Débit atteint (%s/%s par minute).', v_utilise_minute, v_ligne.quota_minute_limite),
      v_debut_minute + interval '1 minute';
    return;
  end if;

  if v_ligne.quota_limite is not null and v_utilise >= v_ligne.quota_limite then
    return query select
      false,
      format('Quota atteint (%s/%s par %s).', v_utilise, v_ligne.quota_limite,
             lower(v_ligne.fenetre_quota::text)),
      case v_ligne.fenetre_quota
        when 'MINUTE' then v_debut_principal + interval '1 minute'
        when 'HEURE'  then v_debut_principal + interval '1 hour'
        when 'JOUR'   then v_debut_principal + interval '1 day'
        when 'MOIS'   then v_debut_principal + interval '1 month'
      end;
    return;
  end if;

  update public.fournisseurs_donnees
     set quota_utilise = v_utilise + 1,
         quota_reinitialise_le = v_debut_principal,
         quota_minute_utilise = v_utilise_minute + 1,
         quota_minute_reinitialise_le = v_debut_minute,
         derniere_verification_le = p_maintenant
   where profil_id = p_profil_id and code = p_code;

  return query select true, null::text, null::timestamptz;
end;
$fn$;

revoke execute on function public.reserver_appel_fournisseur(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserver_appel_fournisseur(uuid, text, timestamptz)
  to service_role;
