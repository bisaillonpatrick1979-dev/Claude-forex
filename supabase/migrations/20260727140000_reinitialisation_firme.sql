-- Réinitialisation de la firme.
--
-- Trois besoins distincts, volontairement séparés — les confondre ferait
-- perdre à l'utilisateur quelque chose qu'il ne voulait pas perdre :
--
--   1. changer le capital du portefeuille sans rien effacer ;
--   2. repartir de zéro sur les trades tout en gardant ce que les agents ont
--      appris — c'est le cas d'usage principal après un rejeu de cinq ans ;
--   3. tout effacer, leçons comprises, pour un vrai départ à neuf.
--
-- Ce qui n'est JAMAIS touché, quel que soit le choix :
--   - les clés API chiffrées (`cles_api`) ;
--   - le journal d'audit, immuable par trigger ;
--   - les agents, leurs mandats et leurs permissions ;
--   - les playbooks de stratégie.
--
-- L'ordre des suppressions suit les clés étrangères : transactions avant
-- positions, positions avant ordres, et ainsi de suite. Une suppression dans
-- le désordre échouerait à mi-parcours en laissant la base incohérente.

create or replace function public.reinitialiser_firme(
  p_capital numeric default null,
  p_conserver_lecons boolean default true,
  p_effacer_historique boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profil uuid := auth.uid();
  v_portefeuille uuid;
  v_capital numeric;
  v_supprimes jsonb := '{}'::jsonb;
  v_compte integer;
begin
  if v_profil is null then
    raise exception 'Aucune session : réinitialisation refusée.';
  end if;

  select id, capital_initial into v_portefeuille, v_capital
  from public.portefeuilles
  where profil_id = v_profil
  limit 1;

  if v_portefeuille is null then
    raise exception 'Aucun portefeuille pour ce profil.';
  end if;

  -- Un capital nul ou négatif rendrait tous les pourcentages de risque
  -- indéfinis : on refuse plutôt que de produire des divisions par zéro
  -- silencieuses dans les garde-fous.
  if p_capital is not null then
    if p_capital <= 0 then
      raise exception 'Le capital doit être strictement positif.';
    end if;
    v_capital := p_capital;
  end if;

  if p_effacer_historique then
    delete from public.transactions where profil_id = v_profil;
    get diagnostics v_compte = row_count;
    v_supprimes := v_supprimes || jsonb_build_object('transactions', v_compte);

    delete from public.positions where profil_id = v_profil;
    get diagnostics v_compte = row_count;
    v_supprimes := v_supprimes || jsonb_build_object('positions', v_compte);

    delete from public.ordres where profil_id = v_profil;
    get diagnostics v_compte = row_count;
    v_supprimes := v_supprimes || jsonb_build_object('ordres', v_compte);

    delete from public.decisions_risque where profil_id = v_profil;
    delete from public.propositions_ordres where profil_id = v_profil;
    get diagnostics v_compte = row_count;
    v_supprimes := v_supprimes || jsonb_build_object('propositions', v_compte);

    delete from public.vues_marche where profil_id = v_profil;
    delete from public.rapports_analyse where profil_id = v_profil;
    delete from public.messages_agents where profil_id = v_profil;

    delete from public.cycles where profil_id = v_profil;
    get diagnostics v_compte = row_count;
    v_supprimes := v_supprimes || jsonb_build_object('cycles', v_compte);

    delete from public.instantanes_portefeuille where profil_id = v_profil;
  end if;

  if not p_conserver_lecons then
    delete from public.lecons where profil_id = v_profil;
    get diagnostics v_compte = row_count;
    v_supprimes := v_supprimes || jsonb_build_object('lecons', v_compte);
  end if;

  -- Le portefeuille repart du capital retenu. Le sommet d'équité est remis à
  -- ce niveau : le conserver ferait croire à un drawdown dès la première
  -- seconde et bloquerait les garde-fous.
  update public.portefeuilles
  set capital_initial = v_capital,
      solde = v_capital,
      equite = v_capital,
      marge_utilisee = 0,
      sommet_equite = v_capital,
      gele = false,
      raison_gel = null,
      gele_le = null,
      dernier_horodatage_traite = null,
      rejeu_actif = false,
      rejeu_symbole = null,
      rejeu_intervalle = null,
      rejeu_debut = null,
      rejeu_curseur = null,
      rejeu_fin = null,
      rejeu_source = null,
      -- L'allocation est ramenée à ce qui reste possible : confier 10 000 sur
      -- un compte réinitialisé à 5 000 produirait une enveloppe imaginaire.
      capital_alloue_agents = least(capital_alloue_agents, v_capital)
  where id = v_portefeuille;

  insert into public.journal_audit (profil_id, acteur, action, entite, entite_id, details)
  values (
    v_profil, 'utilisateur', 'REINITIALISATION_FIRME', 'portefeuilles', v_portefeuille::text,
    jsonb_build_object(
      'capital', v_capital,
      'historique_efface', p_effacer_historique,
      'lecons_conservees', p_conserver_lecons,
      'supprimes', v_supprimes
    )
  );

  return jsonb_build_object('capital', v_capital, 'supprimes', v_supprimes);
end;
$fn$;

revoke execute on function public.reinitialiser_firme(numeric, boolean, boolean) from public, anon;
grant execute on function public.reinitialiser_firme(numeric, boolean, boolean) to authenticated;
