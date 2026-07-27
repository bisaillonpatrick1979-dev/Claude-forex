-- Bornes manquantes, maintenant que les limites sont éditables depuis l'app.
--
-- Tant que ces valeurs n'étaient posées que par la migration d'amorçage, leur
-- absence de contrainte ne coûtait rien. Dès qu'un formulaire écrit dedans, la
-- base doit redevenir l'autorité : la validation TypeScript sert à produire un
-- message lisible, pas à garantir l'intégrité — elle est contournable, la
-- contrainte CHECK ne l'est pas.
--
-- Quatre colonnes n'avaient aucune borne :
--
--   * perte_journaliere_max_pct et drawdown_max_pct — un pourcentage négatif
--     rendrait le contrôle vrai en permanence, gelant la firme au premier ordre ;
--   * fenetre_evenement_macro_minutes — une fenêtre négative inverserait la
--     comparaison, et quatre heures est déjà large pour un événement macro ;
--   * plafond_cout_quotidien_usd — un plafond négatif dépasse dès le premier
--     appel, et sans borne haute une faute de frappe engage une dépense réelle.
--
-- Les bornes reproduisent exactement celles de `lib/config/limites.ts`.

alter table public.parametres_risque
  drop constraint if exists parametres_risque_bornes_pertes,
  add constraint parametres_risque_bornes_pertes check (
    perte_journaliere_max_pct > 0 and perte_journaliere_max_pct <= 100
    and drawdown_max_pct > 0 and drawdown_max_pct <= 100
    and fenetre_evenement_macro_minutes >= 0 and fenetre_evenement_macro_minutes <= 240
  );

alter table public.profils
  drop constraint if exists profils_plafond_cout_quotidien_borne,
  add constraint profils_plafond_cout_quotidien_borne check (
    plafond_cout_quotidien_usd >= 0 and plafond_cout_quotidien_usd <= 1000
  );

comment on column public.profils.plafond_cout_quotidien_usd is
  'Dépense maximale en appels de modèles sur une journée UTC. Éditable depuis '
  'Réglages. Atteint : les cycles s''arrêtent net plutôt que de finir à moitié.';

-- Trader et gestionnaire de portefeuille passent d'Opus 5 à Sonnet 5.
--
-- Mesuré, pas supposé : 39 cycles réels ont coûté 4,96 $, et ces deux rôles
-- portaient l'essentiel de la facture à 5 $/25 $ le million de tokens contre
-- 3 $/15 $ pour Sonnet. Le trader décide dans un cadre déjà très contraint par
-- les garde-fous TypeScript — l'écart de modèle y pèse moins qu'ailleurs.
update public.agents
set modele = 'claude-sonnet-5', maj_le = now()
where fournisseur_llm = 'anthropic'
  and modele = 'claude-opus-5'
  and role in ('TRADER', 'GESTIONNAIRE_PORTEFEUILLE');
