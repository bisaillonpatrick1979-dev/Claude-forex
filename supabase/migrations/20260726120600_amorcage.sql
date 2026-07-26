-- Amorçage : référentiel d'instruments, et création automatique de la firme
-- (profil, limites, portefeuille, 12 agents avec leur mandat v1) à l'inscription.

-- --- Référentiel d'instruments ---------------------------------------------
-- Forex 24 h du dimanche 22:00 UTC au vendredi 22:00 UTC ; actions US
-- 13:30–20:00 UTC ; crypto en continu. Les horaires sont exploités par le
-- moteur d'exécution (phase 3) pour refuser un remplissage hors séance.

insert into public.symboles
  (code, libelle, classe_actif, devise_base, devise_cotation, taille_contrat,
   pas_cotation, decimales, spread_defaut_points, horaires_seance)
values
  ('EURUSD', 'Euro / Dollar US',        'FOREX', 'EUR', 'USD', 100000, 0.00001, 5, 1.0,
   '{"0":[["22:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","22:00"]]}'),
  ('GBPUSD', 'Livre sterling / Dollar US', 'FOREX', 'GBP', 'USD', 100000, 0.00001, 5, 1.4,
   '{"0":[["22:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","22:00"]]}'),
  ('USDJPY', 'Dollar US / Yen',         'FOREX', 'USD', 'JPY', 100000, 0.001,   3, 1.2,
   '{"0":[["22:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","22:00"]]}'),
  ('USDCAD', 'Dollar US / Dollar canadien', 'FOREX', 'USD', 'CAD', 100000, 0.00001, 5, 1.8,
   '{"0":[["22:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","22:00"]]}'),
  ('AUDUSD', 'Dollar australien / Dollar US', 'FOREX', 'AUD', 'USD', 100000, 0.00001, 5, 1.3,
   '{"0":[["22:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","22:00"]]}'),
  ('XAUUSD', 'Or / Dollar US', 'MATIERE_PREMIERE', 'XAU', 'USD', 100, 0.01, 2, 25.0,
   '{"0":[["22:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","22:00"]]}'),
  ('NAS100', 'Nasdaq 100', 'INDICE', null, 'USD', 1, 0.25, 2, 1.0,
   '{"1":[["13:30","20:00"]],"2":[["13:30","20:00"]],"3":[["13:30","20:00"]],"4":[["13:30","20:00"]],"5":[["13:30","20:00"]]}'),
  ('SPX500', 'S&P 500', 'INDICE', null, 'USD', 1, 0.25, 2, 0.6,
   '{"1":[["13:30","20:00"]],"2":[["13:30","20:00"]],"3":[["13:30","20:00"]],"4":[["13:30","20:00"]],"5":[["13:30","20:00"]]}'),
  ('AAPL', 'Apple Inc.',      'ACTION', null, 'USD', 1, 0.01, 2, 1.0,
   '{"1":[["13:30","20:00"]],"2":[["13:30","20:00"]],"3":[["13:30","20:00"]],"4":[["13:30","20:00"]],"5":[["13:30","20:00"]]}'),
  ('MSFT', 'Microsoft Corp.', 'ACTION', null, 'USD', 1, 0.01, 2, 1.0,
   '{"1":[["13:30","20:00"]],"2":[["13:30","20:00"]],"3":[["13:30","20:00"]],"4":[["13:30","20:00"]],"5":[["13:30","20:00"]]}'),
  ('NVDA', 'NVIDIA Corp.',    'ACTION', null, 'USD', 1, 0.01, 2, 1.0,
   '{"1":[["13:30","20:00"]],"2":[["13:30","20:00"]],"3":[["13:30","20:00"]],"4":[["13:30","20:00"]],"5":[["13:30","20:00"]]}'),
  ('BTCUSD', 'Bitcoin / Dollar US',  'CRYPTO', 'BTC', 'USD', 1, 0.01, 2, 20.0,
   '{"0":[["00:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","23:59"]],"6":[["00:00","23:59"]]}'),
  ('ETHUSD', 'Ethereum / Dollar US', 'CRYPTO', 'ETH', 'USD', 1, 0.01, 2, 2.0,
   '{"0":[["00:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","23:59"]],"6":[["00:00","23:59"]]}');

-- Correspondances par fournisseur. Aucun adaptateur n'a le droit de deviner un
-- symbole externe : s'il n'est pas dans cette table, le fournisseur est
-- considéré comme incapable de servir l'instrument.
insert into public.correspondances_symboles (symbole_id, fournisseur_code, symbole_externe)
select s.id, m.fournisseur_code, m.symbole_externe
from public.symboles s
join (values
  ('EURUSD','yahoo','EURUSD=X'), ('EURUSD','twelvedata','EUR/USD'), ('EURUSD','finnhub','OANDA:EUR_USD'), ('EURUSD','mock','EURUSD'),
  ('GBPUSD','yahoo','GBPUSD=X'), ('GBPUSD','twelvedata','GBP/USD'), ('GBPUSD','finnhub','OANDA:GBP_USD'), ('GBPUSD','mock','GBPUSD'),
  ('USDJPY','yahoo','USDJPY=X'), ('USDJPY','twelvedata','USD/JPY'), ('USDJPY','finnhub','OANDA:USD_JPY'), ('USDJPY','mock','USDJPY'),
  ('USDCAD','yahoo','USDCAD=X'), ('USDCAD','twelvedata','USD/CAD'), ('USDCAD','finnhub','OANDA:USD_CAD'), ('USDCAD','mock','USDCAD'),
  ('AUDUSD','yahoo','AUDUSD=X'), ('AUDUSD','twelvedata','AUD/USD'), ('AUDUSD','finnhub','OANDA:AUD_USD'), ('AUDUSD','mock','AUDUSD'),
  ('XAUUSD','yahoo','GC=F'),     ('XAUUSD','twelvedata','XAU/USD'), ('XAUUSD','mock','XAUUSD'),
  ('NAS100','yahoo','^NDX'),     ('NAS100','twelvedata','NDX'),     ('NAS100','mock','NAS100'),
  ('SPX500','yahoo','^GSPC'),    ('SPX500','twelvedata','SPX'),     ('SPX500','mock','SPX500'),
  ('AAPL','yahoo','AAPL'),       ('AAPL','twelvedata','AAPL'),      ('AAPL','finnhub','AAPL'), ('AAPL','alpaca','AAPL'), ('AAPL','mock','AAPL'),
  ('MSFT','yahoo','MSFT'),       ('MSFT','twelvedata','MSFT'),      ('MSFT','finnhub','MSFT'), ('MSFT','alpaca','MSFT'), ('MSFT','mock','MSFT'),
  ('NVDA','yahoo','NVDA'),       ('NVDA','twelvedata','NVDA'),      ('NVDA','finnhub','NVDA'), ('NVDA','alpaca','NVDA'), ('NVDA','mock','NVDA'),
  ('BTCUSD','yahoo','BTC-USD'),  ('BTCUSD','twelvedata','BTC/USD'), ('BTCUSD','finnhub','BINANCE:BTCUSDT'), ('BTCUSD','alpaca','BTC/USD'), ('BTCUSD','mock','BTCUSD'),
  ('ETHUSD','yahoo','ETH-USD'),  ('ETHUSD','twelvedata','ETH/USD'), ('ETHUSD','finnhub','BINANCE:ETHUSDT'), ('ETHUSD','alpaca','ETH/USD'), ('ETHUSD','mock','ETHUSD')
) as m(code, fournisseur_code, symbole_externe) on m.code = s.code;

-- --- Création de la firme à l'inscription -----------------------------------

create or replace function public.initialiser_profil()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_agent record;
  v_agent_id uuid;
begin
  insert into public.profils (id, courriel, nom_affichage)
  values (new.id, coalesce(new.email, ''), split_part(coalesce(new.email, ''), '@', 1));

  insert into public.parametres_risque (profil_id) values (new.id);
  insert into public.portefeuilles (profil_id) values (new.id);

  -- Quotas des paliers gratuits constatés en juillet 2026. Ils sont éditables
  -- dans Réglages → Fournisseurs : ces valeurs ne sont qu'un point de départ.
  insert into public.fournisseurs_donnees
    (profil_id, code, nom, actif, quota_limite, fenetre_quota, priorite_par_classe)
  values
    (new.id, 'mock', 'Mock (déterministe)', true, null, 'JOUR',
     '{"FOREX":9,"INDICE":9,"ACTION":9,"CRYPTO":9,"MATIERE_PREMIERE":9}'),
    (new.id, 'twelvedata', 'Twelve Data', false, 800, 'JOUR',
     '{"FOREX":1,"INDICE":1,"ACTION":2,"CRYPTO":2,"MATIERE_PREMIERE":1}'),
    (new.id, 'yahoo', 'Yahoo Finance (non officiel)', false, 500, 'JOUR',
     '{"FOREX":3,"INDICE":2,"ACTION":3,"CRYPTO":3,"MATIERE_PREMIERE":2}'),
    (new.id, 'finnhub', 'Finnhub', false, 60, 'MINUTE',
     '{"FOREX":2,"ACTION":1,"CRYPTO":1}'),
    (new.id, 'alphavantage', 'Alpha Vantage', false, 25, 'JOUR',
     '{"ACTION":4}'),
    (new.id, 'alpaca', 'Alpaca', false, null, 'MINUTE',
     '{"ACTION":1,"CRYPTO":3}');

  for v_agent in
    select * from (values
      ('analyste_technique', 'Analyste technique', 'ANALYSTE_TECHNIQUE', '#38bdf8', 10,
       array['donnees_marche','indicateurs'],
       'Tu es analyste technique dans une firme de trading. Tu reçois un snapshot de chandeliers et d''indicateurs. Tu décris la structure de marché, les supports et résistances, la tendance, le RSI, le MACD, l''ATR et le volume. Règle absolue : tu ne cites aucun prix qui ne figure pas dans le snapshot fourni. Si une donnée manque, tu écris « donnée manquante » au lieu de l''estimer. Tu rends un rapport chiffré avec des niveaux exacts et un degré de confiance de 0 à 100.'),
      ('analyste_macro', 'Analyste macro / Forex', 'ANALYSTE_MACRO', '#a78bfa', 20,
       array['calendrier_economique','donnees_marche'],
       'Tu es analyste macroéconomique spécialisé sur les devises. Tu couvres le calendrier économique, les décisions de banques centrales, les différentiels de taux, le DXY et l''enchaînement des sessions Asie / Londres / New York. Tu signales explicitement tout événement à fort impact dans les prochaines heures. Tu ne cites que des faits présents dans ton contexte, avec leur horodatage.'),
      ('analyste_fondamental', 'Analyste fondamental', 'ANALYSTE_FONDAMENTAL', '#34d399', 30,
       array['fondamentaux','donnees_marche'],
       'Tu es analyste fondamental actions et indices. Tu couvres les résultats, les valorisations, le poids des composantes d''un indice et la rotation sectorielle. Pour un indice comme le Nasdaq, tu expliques quelles composantes portent le mouvement. Tu ne cites aucun chiffre absent de ton contexte.'),
      ('analyste_sentiment', 'Analyste sentiment & nouvelles', 'ANALYSTE_SENTIMENT', '#fbbf24', 40,
       array['nouvelles','sentiment'],
       'Tu es analyste sentiment et flux de nouvelles. Tu résumes le ton du marché et les événements à risque. Chaque affirmation doit être accompagnée de sa source et de son horodatage. Sans source, tu n''affirmes rien.'),
      ('analyste_volatilite', 'Analyste volatilité & liquidité', 'ANALYSTE_VOLATILITE', '#f472b6', 50,
       array['donnees_marche','indicateurs'],
       'Tu es analyste volatilité et liquidité. Tu évalues l''ATR, les spreads, les heures creuses et les événements à venir. Ton rôle principal est de dire quand il ne faut pas trader. Tu conclus toujours par un verdict explicite : conditions favorables, dégradées ou hostiles.'),
      ('chercheur_haussier', 'Chercheur haussier', 'CHERCHEUR_HAUSSIER', '#22c55e', 60,
       array[]::text[],
       'Tu construis la meilleure thèse d''achat possible à partir des rapports d''analyse fournis. Tu t''appuies uniquement sur ces rapports. Tu énonces ta thèse, tes niveaux, ton invalidation, et tu réponds point par point aux arguments du chercheur baissier. Tu n''inventes aucune donnée.'),
      ('chercheur_baissier', 'Chercheur baissier', 'CHERCHEUR_BAISSIER', '#ef4444', 70,
       array[]::text[],
       'Tu construis la meilleure thèse de vente possible à partir des rapports d''analyse fournis, et tu attaques explicitement les arguments du chercheur haussier. Tu t''appuies uniquement sur ces rapports. Tu énonces ta thèse, tes niveaux, ton invalidation. Tu n''inventes aucune donnée.'),
      ('directeur_recherche', 'Directeur de recherche', 'DIRECTEUR_RECHERCHE', '#c084fc', 80,
       array[]::text[],
       'Tu arbitres le débat entre le chercheur haussier et le chercheur baissier. Tu pondères la solidité des arguments et leur ancrage dans les données, jamais leur volume ni leur longueur. Tu produis une vue de marché : direction (HAUSSIER, BAISSIER ou NEUTRE), conviction de 0 à 100, horizon, et niveau d''invalidation. NEUTRE est une conclusion parfaitement acceptable.'),
      ('trader', 'Trader', 'TRADER', '#60a5fa', 90,
       array['donnees_marche'],
       'Tu traduis la vue de marché en un ordre concret : symbole, sens, taille, prix d''entrée, stop-loss, take-profit, type d''ordre et durée de validité. Tu refuses de proposer un ordre sans stop-loss. Si la vue est NEUTRE ou la conviction faible, tu proposes de ne rien faire, et c''est une réponse valide.'),
      ('gestionnaire_risque', 'Gestionnaire de risque', 'GESTIONNAIRE_RISQUE', '#fb923c', 100,
       array['etat_portefeuille'],
       'Tu es gestionnaire de risque, indépendant de l''équipe de trading, avec pouvoir de veto. Tu vérifies l''exposition totale, la corrélation entre positions ouvertes, le risque par trade, le drawdown courant et la marge. Tu peux réduire une taille plutôt que refuser. Tu motives chaque décision en une phrase claire. Les plafonds chiffrés sont appliqués par le code serveur : ton rôle est le jugement, pas le calcul de la limite.'),
      ('gestionnaire_portefeuille', 'Gestionnaire de portefeuille', 'GESTIONNAIRE_PORTEFEUILLE', '#e2e8f0', 110,
       array['etat_portefeuille','soumettre_ordre'],
       'Tu es le gestionnaire de portefeuille, seul habilité à soumettre un ordre. Tu tranches à partir de la vue de marché, de la proposition du trader et de l''avis du gestionnaire de risque. Tu peux approuver, réduire, reporter ou refuser. Tu écris une justification courte qui sera archivée avec l''ordre.'),
      ('agent_reflexion', 'Agent de réflexion', 'AGENT_REFLEXION', '#94a3b8', 120,
       array['historique_positions'],
       'Tu analyses une position fermée : ce qui était attendu, ce qui s''est produit, et pourquoi. Tu écris une leçon courte, concrète et réutilisable, rattachée au symbole et aux conditions de marché. Une leçon inutilisable dans un cycle futur ne vaut rien : sois spécifique.')
    ) as t(cle, nom, role, couleur, ordre, outils, mandat)
  loop
    insert into public.agents
      (profil_id, cle, nom, role, couleur, ordre_affichage, outils_autorises)
    values
      (new.id, v_agent.cle, v_agent.nom, v_agent.role::public.role_agent,
       v_agent.couleur, v_agent.ordre, v_agent.outils)
    returning id into v_agent_id;

    insert into public.mandats_agents (profil_id, agent_id, version, contenu)
    values (new.id, v_agent_id, 1, v_agent.mandat);
  end loop;

  insert into public.journal_audit (profil_id, acteur, action, entite, entite_id)
  values (new.id, 'systeme', 'CREATION_FIRME', 'profils', new.id::text);

  return new;
end;
$fn$;

create trigger creation_firme_apres_inscription
  after insert on auth.users
  for each row execute function public.initialiser_profil();
