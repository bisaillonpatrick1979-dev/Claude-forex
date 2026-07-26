-- Extensions et types énumérés partagés par tout le schéma.
-- Les enums sont préférés aux contraintes CHECK : ils sont introspectables par
-- le générateur de types TypeScript de Supabase, ce qui évite de dupliquer les
-- unions de chaînes à la main côté application.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector" with schema extensions;

-- Les trois modes d'opération. RÉEL_VALIDATION existe dans le type pour que le
-- schéma soit prêt, mais il est bloqué par un drapeau serveur jusqu'à la phase 7.
create type public.mode_operation as enum (
  'PAPIER_AUTONOME',
  'PAPIER_VALIDATION',
  'REEL_VALIDATION'
);

create type public.classe_actif as enum (
  'FOREX',
  'INDICE',
  'ACTION',
  'CRYPTO',
  'MATIERE_PREMIERE'
);

create type public.intervalle as enum (
  'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'
);

-- L'organigramme de la firme. L'ordre de déclaration suit les étages 1 → 3.
create type public.role_agent as enum (
  'ANALYSTE_TECHNIQUE',
  'ANALYSTE_MACRO',
  'ANALYSTE_FONDAMENTAL',
  'ANALYSTE_SENTIMENT',
  'ANALYSTE_VOLATILITE',
  'CHERCHEUR_HAUSSIER',
  'CHERCHEUR_BAISSIER',
  'DIRECTEUR_RECHERCHE',
  'TRADER',
  'GESTIONNAIRE_RISQUE',
  'GESTIONNAIRE_PORTEFEUILLE',
  'AGENT_REFLEXION'
);

create type public.fournisseur_llm as enum (
  'anthropic',
  'openai',
  'google',
  'mock'
);

-- États de la machine du cycle de décision. Toute transition est persistée :
-- un cycle interrompu doit être reprenable ou marqué ECHOUE proprement.
create type public.etat_cycle as enum (
  'EN_ATTENTE',
  'COLLECTE_DONNEES',
  'ANALYSE',
  'DEBAT',
  'SYNTHESE',
  'PROPOSITION',
  'CONTROLE_RISQUE',
  'DECISION_PM',
  'EXECUTION',
  'JOURNALISATION',
  'TERMINE',
  'ECHOUE',
  'ABANDONNE'
);

create type public.declencheur_cycle as enum (
  'MANUEL',
  'PLANIFIE',
  'EVENEMENT'
);

create type public.sens_ordre as enum ('ACHAT', 'VENTE');

create type public.type_ordre as enum ('MARCHE', 'LIMITE', 'STOP');

create type public.statut_proposition as enum (
  'PROPOSEE',
  'EN_CONTROLE_RISQUE',
  'REJETEE_RISQUE',
  'EN_ATTENTE_VALIDATION',
  'REFUSEE_UTILISATEUR',
  'ACCEPTEE',
  'EXPIREE'
);

create type public.statut_ordre as enum (
  'EN_ATTENTE',
  'PARTIELLEMENT_REMPLI',
  'REMPLI',
  'ANNULE',
  'EXPIRE',
  'REJETE'
);

create type public.statut_position as enum ('OUVERTE', 'FERMEE', 'LIQUIDEE');

create type public.decision_risque as enum ('APPROUVE', 'REDUIT', 'REFUSE');

create type public.type_transaction as enum (
  'DEPOT',
  'RETRAIT',
  'COMMISSION',
  'SWAP',
  'PROFIT_PERTE',
  'AJUSTEMENT'
);

create type public.fenetre_quota as enum ('MINUTE', 'HEURE', 'JOUR', 'MOIS');

create type public.statut_backtest as enum (
  'EN_ATTENTE',
  'EN_COURS',
  'TERMINE',
  'ECHOUE'
);

-- Horodatage de mise à jour : un seul trigger réutilisé partout.
create or replace function public.maj_horodatage()
returns trigger
language plpgsql
as $$
begin
  new.maj_le = now();
  return new;
end;
$$;
