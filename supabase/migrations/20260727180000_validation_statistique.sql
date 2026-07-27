-- Validation statistique d'un backtest.
--
-- Sans elle, la métrique d'un backtest mesure surtout l'adhérence au passé :
-- essayer quarante stratégies et garder la meilleure produit toujours une
-- gagnante, même sur des données purement aléatoires.
--
-- Le bloc stocke le walk-forward hors échantillon, le Monte-Carlo sur l'ordre
-- des trades, et le Sharpe dégonflé — corrigé du nombre d'essais menés.
alter table public.backtests
  add column if not exists validation jsonb;

comment on column public.backtests.validation is
  'Walk-forward hors echantillon, Monte-Carlo sur l ordre des trades, et correction pour essais multiples. Le seul bloc qui dise si le resultat se distingue du hasard.';
