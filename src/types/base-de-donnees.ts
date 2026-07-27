export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agents: {
        Row: {
          actif: boolean;
          cle: string;
          couleur: string;
          cree_le: string;
          effort_llm: string;
          famille_strategie: string | null;
          fournisseur_llm: Database["public"]["Enums"]["fournisseur_llm"];
          id: string;
          maj_le: string;
          modele: string;
          nom: string;
          ordre_affichage: number;
          outils_autorises: string[];
          profil_id: string;
          role: Database["public"]["Enums"]["role_agent"];
          temperature: number;
          tokens_max: number;
        };
        Insert: {
          actif?: boolean;
          cle: string;
          couleur?: string;
          cree_le?: string;
          effort_llm?: string;
          famille_strategie?: string | null;
          fournisseur_llm?: Database["public"]["Enums"]["fournisseur_llm"];
          id?: string;
          maj_le?: string;
          modele?: string;
          nom: string;
          ordre_affichage?: number;
          outils_autorises?: string[];
          profil_id: string;
          role: Database["public"]["Enums"]["role_agent"];
          temperature?: number;
          tokens_max?: number;
        };
        Update: {
          actif?: boolean;
          cle?: string;
          couleur?: string;
          cree_le?: string;
          effort_llm?: string;
          famille_strategie?: string | null;
          fournisseur_llm?: Database["public"]["Enums"]["fournisseur_llm"];
          id?: string;
          maj_le?: string;
          modele?: string;
          nom?: string;
          ordre_affichage?: number;
          outils_autorises?: string[];
          profil_id?: string;
          role?: Database["public"]["Enums"]["role_agent"];
          temperature?: number;
          tokens_max?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agents_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      annotations_graphique: {
        Row: {
          couleur: string;
          cree_le: string;
          id: string;
          intervalle: string | null;
          libelle: string | null;
          maj_le: string;
          outil: string;
          points: Json;
          profil_id: string;
          symbole: string;
        };
        Insert: {
          couleur?: string;
          cree_le?: string;
          id?: string;
          intervalle?: string | null;
          libelle?: string | null;
          maj_le?: string;
          outil: string;
          points: Json;
          profil_id: string;
          symbole: string;
        };
        Update: {
          couleur?: string;
          cree_le?: string;
          id?: string;
          intervalle?: string | null;
          libelle?: string | null;
          maj_le?: string;
          outil?: string;
          points?: Json;
          profil_id?: string;
          symbole?: string;
        };
        Relationships: [
          {
            foreignKeyName: "annotations_graphique_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      appels_llm: {
        Row: {
          agent_id: string | null;
          cout_usd: number;
          cree_le: string;
          cycle_id: string | null;
          erreur: string | null;
          fournisseur: Database["public"]["Enums"]["fournisseur_llm"];
          id: string;
          latence_ms: number | null;
          modele: string;
          profil_id: string;
          succes: boolean;
          tokens_entree: number;
          tokens_sortie: number;
        };
        Insert: {
          agent_id?: string | null;
          cout_usd?: number;
          cree_le?: string;
          cycle_id?: string | null;
          erreur?: string | null;
          fournisseur: Database["public"]["Enums"]["fournisseur_llm"];
          id?: string;
          latence_ms?: number | null;
          modele: string;
          profil_id: string;
          succes?: boolean;
          tokens_entree?: number;
          tokens_sortie?: number;
        };
        Update: {
          agent_id?: string | null;
          cout_usd?: number;
          cree_le?: string;
          cycle_id?: string | null;
          erreur?: string | null;
          fournisseur?: Database["public"]["Enums"]["fournisseur_llm"];
          id?: string;
          latence_ms?: number | null;
          modele?: string;
          profil_id?: string;
          succes?: boolean;
          tokens_entree?: number;
          tokens_sortie?: number;
        };
        Relationships: [
          {
            foreignKeyName: "appels_llm_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appels_llm_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appels_llm_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      backtests: {
        Row: {
          capital_initial: number;
          comparateurs: Json | null;
          configuration: Json;
          courbe_equite: Json | null;
          cree_le: string;
          debut: string;
          erreur: string | null;
          fin: string;
          id: string;
          intervalle: Database["public"]["Enums"]["intervalle"];
          metriques: Json | null;
          profil_id: string;
          statut: Database["public"]["Enums"]["statut_backtest"];
          symbole_id: string;
          termine_le: string | null;
          validation: Json | null;
        };
        Insert: {
          capital_initial: number;
          comparateurs?: Json | null;
          configuration?: Json;
          courbe_equite?: Json | null;
          cree_le?: string;
          debut: string;
          erreur?: string | null;
          fin: string;
          id?: string;
          intervalle: Database["public"]["Enums"]["intervalle"];
          metriques?: Json | null;
          profil_id: string;
          statut?: Database["public"]["Enums"]["statut_backtest"];
          symbole_id: string;
          termine_le?: string | null;
          validation?: Json | null;
        };
        Update: {
          capital_initial?: number;
          comparateurs?: Json | null;
          configuration?: Json;
          courbe_equite?: Json | null;
          cree_le?: string;
          debut?: string;
          erreur?: string | null;
          fin?: string;
          id?: string;
          intervalle?: Database["public"]["Enums"]["intervalle"];
          metriques?: Json | null;
          profil_id?: string;
          statut?: Database["public"]["Enums"]["statut_backtest"];
          symbole_id?: string;
          termine_le?: string | null;
          validation?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "backtests_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "backtests_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      chandeliers: {
        Row: {
          bas: number;
          cloture: number;
          fermee: boolean;
          fournisseur_code: string;
          haut: number;
          horodatage: string;
          intervalle: Database["public"]["Enums"]["intervalle"];
          ouverture: number;
          perime_le: string | null;
          recupere_le: string;
          symbole_id: string;
          volume: number | null;
        };
        Insert: {
          bas: number;
          cloture: number;
          fermee?: boolean;
          fournisseur_code: string;
          haut: number;
          horodatage: string;
          intervalle: Database["public"]["Enums"]["intervalle"];
          ouverture: number;
          perime_le?: string | null;
          recupere_le?: string;
          symbole_id: string;
          volume?: number | null;
        };
        Update: {
          bas?: number;
          cloture?: number;
          fermee?: boolean;
          fournisseur_code?: string;
          haut?: number;
          horodatage?: string;
          intervalle?: Database["public"]["Enums"]["intervalle"];
          ouverture?: number;
          perime_le?: string | null;
          recupere_le?: string;
          symbole_id?: string;
          volume?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "chandeliers_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      cles_api: {
        Row: {
          cree_le: string;
          etiquette: string | null;
          id: string;
          indice_visuel: string | null;
          maj_le: string;
          profil_id: string;
          service: string;
          valeur_chiffree: string;
        };
        Insert: {
          cree_le?: string;
          etiquette?: string | null;
          id?: string;
          indice_visuel?: string | null;
          maj_le?: string;
          profil_id: string;
          service: string;
          valeur_chiffree: string;
        };
        Update: {
          cree_le?: string;
          etiquette?: string | null;
          id?: string;
          indice_visuel?: string | null;
          maj_le?: string;
          profil_id?: string;
          service?: string;
          valeur_chiffree?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cles_api_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      correspondances_symboles: {
        Row: {
          fournisseur_code: string;
          id: string;
          symbole_externe: string;
          symbole_id: string;
        };
        Insert: {
          fournisseur_code: string;
          id?: string;
          symbole_externe: string;
          symbole_id: string;
        };
        Update: {
          fournisseur_code?: string;
          id?: string;
          symbole_externe?: string;
          symbole_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "correspondances_symboles_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      cycles: {
        Row: {
          appels_llm_utilises: number;
          budget_appels_llm: number;
          budget_secondes: number;
          cout_usd: number;
          declencheur: Database["public"]["Enums"]["declencheur_cycle"];
          demarre_le: string;
          erreur: string | null;
          etat: Database["public"]["Enums"]["etat_cycle"];
          id: string;
          instantane_donnees: Json | null;
          intervalle: Database["public"]["Enums"]["intervalle"];
          maj_le: string;
          portefeuille_id: string;
          profil_id: string;
          symbole_id: string;
          termine_le: string | null;
          tours_debat: number;
        };
        Insert: {
          appels_llm_utilises?: number;
          budget_appels_llm?: number;
          budget_secondes?: number;
          cout_usd?: number;
          declencheur?: Database["public"]["Enums"]["declencheur_cycle"];
          demarre_le?: string;
          erreur?: string | null;
          etat?: Database["public"]["Enums"]["etat_cycle"];
          id?: string;
          instantane_donnees?: Json | null;
          intervalle: Database["public"]["Enums"]["intervalle"];
          maj_le?: string;
          portefeuille_id: string;
          profil_id: string;
          symbole_id: string;
          termine_le?: string | null;
          tours_debat?: number;
        };
        Update: {
          appels_llm_utilises?: number;
          budget_appels_llm?: number;
          budget_secondes?: number;
          cout_usd?: number;
          declencheur?: Database["public"]["Enums"]["declencheur_cycle"];
          demarre_le?: string;
          erreur?: string | null;
          etat?: Database["public"]["Enums"]["etat_cycle"];
          id?: string;
          instantane_donnees?: Json | null;
          intervalle?: Database["public"]["Enums"]["intervalle"];
          maj_le?: string;
          portefeuille_id?: string;
          profil_id?: string;
          symbole_id?: string;
          termine_le?: string | null;
          tours_debat?: number;
        };
        Relationships: [
          {
            foreignKeyName: "cycles_portefeuille_id_fkey";
            columns: ["portefeuille_id"];
            isOneToOne: false;
            referencedRelation: "portefeuilles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cycles_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cycles_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      decisions_risque: {
        Row: {
          controles: Json;
          cree_le: string;
          decision: Database["public"]["Enums"]["decision_risque"];
          id: string;
          profil_id: string;
          proposition_id: string;
          quantite_autorisee: number;
          quantite_demandee: number;
          raison: string;
          risque_estime_pct: number | null;
        };
        Insert: {
          controles?: Json;
          cree_le?: string;
          decision: Database["public"]["Enums"]["decision_risque"];
          id?: string;
          profil_id: string;
          proposition_id: string;
          quantite_autorisee?: number;
          quantite_demandee: number;
          raison: string;
          risque_estime_pct?: number | null;
        };
        Update: {
          controles?: Json;
          cree_le?: string;
          decision?: Database["public"]["Enums"]["decision_risque"];
          id?: string;
          profil_id?: string;
          proposition_id?: string;
          quantite_autorisee?: number;
          quantite_demandee?: number;
          raison?: string;
          risque_estime_pct?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "decisions_risque_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "decisions_risque_proposition_id_fkey";
            columns: ["proposition_id"];
            isOneToOne: false;
            referencedRelation: "propositions_ordres";
            referencedColumns: ["id"];
          },
        ];
      };
      fournisseurs_donnees: {
        Row: {
          actif: boolean;
          code: string;
          cree_le: string;
          dernier_statut: string | null;
          derniere_erreur: string | null;
          derniere_verification_le: string | null;
          fenetre_quota: Database["public"]["Enums"]["fenetre_quota"];
          id: string;
          maj_le: string;
          nom: string;
          priorite_par_classe: Json;
          profil_id: string;
          quota_limite: number | null;
          quota_minute_limite: number | null;
          quota_minute_reinitialise_le: string;
          quota_minute_utilise: number;
          quota_reinitialise_le: string;
          quota_utilise: number;
        };
        Insert: {
          actif?: boolean;
          code: string;
          cree_le?: string;
          dernier_statut?: string | null;
          derniere_erreur?: string | null;
          derniere_verification_le?: string | null;
          fenetre_quota?: Database["public"]["Enums"]["fenetre_quota"];
          id?: string;
          maj_le?: string;
          nom: string;
          priorite_par_classe?: Json;
          profil_id: string;
          quota_limite?: number | null;
          quota_minute_limite?: number | null;
          quota_minute_reinitialise_le?: string;
          quota_minute_utilise?: number;
          quota_reinitialise_le?: string;
          quota_utilise?: number;
        };
        Update: {
          actif?: boolean;
          code?: string;
          cree_le?: string;
          dernier_statut?: string | null;
          derniere_erreur?: string | null;
          derniere_verification_le?: string | null;
          fenetre_quota?: Database["public"]["Enums"]["fenetre_quota"];
          id?: string;
          maj_le?: string;
          nom?: string;
          priorite_par_classe?: Json;
          profil_id?: string;
          quota_limite?: number | null;
          quota_minute_limite?: number | null;
          quota_minute_reinitialise_le?: string;
          quota_minute_utilise?: number;
          quota_reinitialise_le?: string;
          quota_utilise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "fournisseurs_donnees_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      instantanes_portefeuille: {
        Row: {
          cree_le: string;
          drawdown_pct: number;
          equite: number;
          id: string;
          jour: string;
          pnl_jour: number;
          portefeuille_id: string;
          positions_ouvertes: number;
          profil_id: string;
          solde: number;
        };
        Insert: {
          cree_le?: string;
          drawdown_pct?: number;
          equite: number;
          id?: string;
          jour: string;
          pnl_jour?: number;
          portefeuille_id: string;
          positions_ouvertes?: number;
          profil_id: string;
          solde: number;
        };
        Update: {
          cree_le?: string;
          drawdown_pct?: number;
          equite?: number;
          id?: string;
          jour?: string;
          pnl_jour?: number;
          portefeuille_id?: string;
          positions_ouvertes?: number;
          profil_id?: string;
          solde?: number;
        };
        Relationships: [
          {
            foreignKeyName: "instantanes_portefeuille_portefeuille_id_fkey";
            columns: ["portefeuille_id"];
            isOneToOne: false;
            referencedRelation: "portefeuilles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "instantanes_portefeuille_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      journal_audit: {
        Row: {
          acteur: string;
          action: string;
          cree_le: string;
          details: Json;
          entite: string | null;
          entite_id: string | null;
          id: number;
          profil_id: string | null;
        };
        Insert: {
          acteur: string;
          action: string;
          cree_le?: string;
          details?: Json;
          entite?: string | null;
          entite_id?: string | null;
          id?: never;
          profil_id?: string | null;
        };
        Update: {
          acteur?: string;
          action?: string;
          cree_le?: string;
          details?: Json;
          entite?: string | null;
          entite_id?: string | null;
          id?: never;
          profil_id?: string | null;
        };
        Relationships: [];
      };
      lecons: {
        Row: {
          contenu: string;
          cree_le: string;
          cycle_id: string | null;
          embedding: string | null;
          etiquettes: string[];
          id: string;
          methode_embedding: string | null;
          position_id: string | null;
          profil_id: string;
          resultat_pnl: number | null;
          symbole_id: string | null;
          titre: string;
        };
        Insert: {
          contenu: string;
          cree_le?: string;
          cycle_id?: string | null;
          embedding?: string | null;
          etiquettes?: string[];
          id?: string;
          methode_embedding?: string | null;
          position_id?: string | null;
          profil_id: string;
          resultat_pnl?: number | null;
          symbole_id?: string | null;
          titre: string;
        };
        Update: {
          contenu?: string;
          cree_le?: string;
          cycle_id?: string | null;
          embedding?: string | null;
          etiquettes?: string[];
          id?: string;
          methode_embedding?: string | null;
          position_id?: string | null;
          profil_id?: string;
          resultat_pnl?: number | null;
          symbole_id?: string | null;
          titre?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lecons_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lecons_position_id_fkey";
            columns: ["position_id"];
            isOneToOne: false;
            referencedRelation: "positions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lecons_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lecons_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      mandats_agents: {
        Row: {
          actif: boolean;
          agent_id: string;
          contenu: string;
          cree_le: string;
          id: string;
          profil_id: string;
          version: number;
        };
        Insert: {
          actif?: boolean;
          agent_id: string;
          contenu: string;
          cree_le?: string;
          id?: string;
          profil_id: string;
          version: number;
        };
        Update: {
          actif?: boolean;
          agent_id?: string;
          contenu?: string;
          cree_le?: string;
          id?: string;
          profil_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "mandats_agents_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mandats_agents_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      messages_agents: {
        Row: {
          agent_id: string | null;
          contenu: string;
          cout_usd: number | null;
          cree_le: string;
          cycle_id: string;
          en_cours: boolean;
          etat: Database["public"]["Enums"]["etat_cycle"];
          id: string;
          latence_ms: number | null;
          maj_le: string;
          metadonnees: Json;
          profil_id: string;
          resume: string | null;
          sequence: number;
          tokens_entree: number | null;
          tokens_sortie: number | null;
          tour: number;
        };
        Insert: {
          agent_id?: string | null;
          contenu?: string;
          cout_usd?: number | null;
          cree_le?: string;
          cycle_id: string;
          en_cours?: boolean;
          etat: Database["public"]["Enums"]["etat_cycle"];
          id?: string;
          latence_ms?: number | null;
          maj_le?: string;
          metadonnees?: Json;
          profil_id: string;
          resume?: string | null;
          sequence: number;
          tokens_entree?: number | null;
          tokens_sortie?: number | null;
          tour?: number;
        };
        Update: {
          agent_id?: string | null;
          contenu?: string;
          cout_usd?: number | null;
          cree_le?: string;
          cycle_id?: string;
          en_cours?: boolean;
          etat?: Database["public"]["Enums"]["etat_cycle"];
          id?: string;
          latence_ms?: number | null;
          maj_le?: string;
          metadonnees?: Json;
          profil_id?: string;
          resume?: string | null;
          sequence?: number;
          tokens_entree?: number | null;
          tokens_sortie?: number | null;
          tour?: number;
        };
        Relationships: [
          {
            foreignKeyName: "messages_agents_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_agents_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_agents_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      ordres: {
        Row: {
          cree_le: string;
          cycle_id: string | null;
          id: string;
          maj_le: string;
          motif_fin: string | null;
          origine: Database["public"]["Enums"]["origine_position"];
          portefeuille_id: string;
          prix_demande: number | null;
          prix_moyen_rempli: number | null;
          profil_id: string;
          proposition_id: string | null;
          quantite: number;
          quantite_remplie: number;
          rempli_le: string | null;
          sens: Database["public"]["Enums"]["sens_ordre"];
          session_id: string | null;
          statut: Database["public"]["Enums"]["statut_ordre"];
          stop_loss: number | null;
          symbole_id: string;
          take_profit: number | null;
          type_ordre: Database["public"]["Enums"]["type_ordre"];
          valide_jusqu_a: string | null;
        };
        Insert: {
          cree_le?: string;
          cycle_id?: string | null;
          id?: string;
          maj_le?: string;
          motif_fin?: string | null;
          origine?: Database["public"]["Enums"]["origine_position"];
          portefeuille_id: string;
          prix_demande?: number | null;
          prix_moyen_rempli?: number | null;
          profil_id: string;
          proposition_id?: string | null;
          quantite: number;
          quantite_remplie?: number;
          rempli_le?: string | null;
          sens: Database["public"]["Enums"]["sens_ordre"];
          session_id?: string | null;
          statut?: Database["public"]["Enums"]["statut_ordre"];
          stop_loss?: number | null;
          symbole_id: string;
          take_profit?: number | null;
          type_ordre: Database["public"]["Enums"]["type_ordre"];
          valide_jusqu_a?: string | null;
        };
        Update: {
          cree_le?: string;
          cycle_id?: string | null;
          id?: string;
          maj_le?: string;
          motif_fin?: string | null;
          origine?: Database["public"]["Enums"]["origine_position"];
          portefeuille_id?: string;
          prix_demande?: number | null;
          prix_moyen_rempli?: number | null;
          profil_id?: string;
          proposition_id?: string | null;
          quantite?: number;
          quantite_remplie?: number;
          rempli_le?: string | null;
          sens?: Database["public"]["Enums"]["sens_ordre"];
          session_id?: string | null;
          statut?: Database["public"]["Enums"]["statut_ordre"];
          stop_loss?: number | null;
          symbole_id?: string;
          take_profit?: number | null;
          type_ordre?: Database["public"]["Enums"]["type_ordre"];
          valide_jusqu_a?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ordres_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordres_portefeuille_id_fkey";
            columns: ["portefeuille_id"];
            isOneToOne: false;
            referencedRelation: "portefeuilles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordres_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordres_proposition_id_fkey";
            columns: ["proposition_id"];
            isOneToOne: false;
            referencedRelation: "propositions_ordres";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordres_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions_autonomes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ordres_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      parametres_risque: {
        Row: {
          cree_le: string;
          drawdown_max_pct: number;
          fenetre_evenement_macro_minutes: number;
          id: string;
          levier_max: number;
          maj_le: string;
          part_facteur_max_pct: number;
          part_position_max_pct: number;
          perte_journaliere_max_pct: number;
          positions_max: number;
          profil_id: string;
          risque_max_par_trade_pct: number;
          risque_total_max_pct: number;
          stop_loss_obligatoire: boolean;
        };
        Insert: {
          cree_le?: string;
          drawdown_max_pct?: number;
          fenetre_evenement_macro_minutes?: number;
          id?: string;
          levier_max?: number;
          maj_le?: string;
          part_facteur_max_pct?: number;
          part_position_max_pct?: number;
          perte_journaliere_max_pct?: number;
          positions_max?: number;
          profil_id: string;
          risque_max_par_trade_pct?: number;
          risque_total_max_pct?: number;
          stop_loss_obligatoire?: boolean;
        };
        Update: {
          cree_le?: string;
          drawdown_max_pct?: number;
          fenetre_evenement_macro_minutes?: number;
          id?: string;
          levier_max?: number;
          maj_le?: string;
          part_facteur_max_pct?: number;
          part_position_max_pct?: number;
          perte_journaliere_max_pct?: number;
          positions_max?: number;
          profil_id?: string;
          risque_max_par_trade_pct?: number;
          risque_total_max_pct?: number;
          stop_loss_obligatoire?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "parametres_risque_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: true;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions_agents: {
        Row: {
          agent_id: string;
          classes_autorisees: Database["public"]["Enums"]["classe_actif"][];
          confiance_minimale: number | null;
          cree_le: string;
          id: string;
          maj_le: string;
          niveau: Database["public"]["Enums"]["niveau_autonomie"];
          peut_fermer: boolean;
          peut_modifier_protections: boolean;
          peut_ouvrir: boolean;
          profil_id: string;
          raison_suspension: string | null;
          risque_max_par_trade_pct: number | null;
          seuil_validation_lots: number | null;
          suspendu_jusqu_a: string | null;
          symboles_autorises: string[];
          taille_max_lots: number | null;
          trades_max_par_jour: number | null;
          validite_validation_minutes: number;
        };
        Insert: {
          agent_id: string;
          classes_autorisees?: Database["public"]["Enums"]["classe_actif"][];
          confiance_minimale?: number | null;
          cree_le?: string;
          id?: string;
          maj_le?: string;
          niveau?: Database["public"]["Enums"]["niveau_autonomie"];
          peut_fermer?: boolean;
          peut_modifier_protections?: boolean;
          peut_ouvrir?: boolean;
          profil_id: string;
          raison_suspension?: string | null;
          risque_max_par_trade_pct?: number | null;
          seuil_validation_lots?: number | null;
          suspendu_jusqu_a?: string | null;
          symboles_autorises?: string[];
          taille_max_lots?: number | null;
          trades_max_par_jour?: number | null;
          validite_validation_minutes?: number;
        };
        Update: {
          agent_id?: string;
          classes_autorisees?: Database["public"]["Enums"]["classe_actif"][];
          confiance_minimale?: number | null;
          cree_le?: string;
          id?: string;
          maj_le?: string;
          niveau?: Database["public"]["Enums"]["niveau_autonomie"];
          peut_fermer?: boolean;
          peut_modifier_protections?: boolean;
          peut_ouvrir?: boolean;
          profil_id?: string;
          raison_suspension?: string | null;
          risque_max_par_trade_pct?: number | null;
          seuil_validation_lots?: number | null;
          suspendu_jusqu_a?: string | null;
          symboles_autorises?: string[];
          taille_max_lots?: number | null;
          trades_max_par_jour?: number | null;
          validite_validation_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "permissions_agents_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: true;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permissions_agents_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      portefeuilles: {
        Row: {
          capital_alloue_agents: number;
          capital_initial: number;
          cree_le: string;
          dernier_horodatage_traite: number | null;
          devise: string;
          equite: number;
          gele: boolean;
          gele_le: string | null;
          id: string;
          maj_le: string;
          marge_utilisee: number;
          mode: Database["public"]["Enums"]["mode_operation"];
          nom: string;
          profil_id: string;
          raison_gel: string | null;
          rejeu_actif: boolean;
          rejeu_curseur: number | null;
          rejeu_debut: number | null;
          rejeu_fin: number | null;
          rejeu_intervalle: Database["public"]["Enums"]["intervalle"] | null;
          rejeu_source: string | null;
          rejeu_symbole: string | null;
          solde: number;
          sommet_equite: number;
        };
        Insert: {
          capital_alloue_agents?: number;
          capital_initial?: number;
          cree_le?: string;
          dernier_horodatage_traite?: number | null;
          devise?: string;
          equite?: number;
          gele?: boolean;
          gele_le?: string | null;
          id?: string;
          maj_le?: string;
          marge_utilisee?: number;
          mode?: Database["public"]["Enums"]["mode_operation"];
          nom?: string;
          profil_id: string;
          raison_gel?: string | null;
          rejeu_actif?: boolean;
          rejeu_curseur?: number | null;
          rejeu_debut?: number | null;
          rejeu_fin?: number | null;
          rejeu_intervalle?: Database["public"]["Enums"]["intervalle"] | null;
          rejeu_source?: string | null;
          rejeu_symbole?: string | null;
          solde?: number;
          sommet_equite?: number;
        };
        Update: {
          capital_alloue_agents?: number;
          capital_initial?: number;
          cree_le?: string;
          dernier_horodatage_traite?: number | null;
          devise?: string;
          equite?: number;
          gele?: boolean;
          gele_le?: string | null;
          id?: string;
          maj_le?: string;
          marge_utilisee?: number;
          mode?: Database["public"]["Enums"]["mode_operation"];
          nom?: string;
          profil_id?: string;
          raison_gel?: string | null;
          rejeu_actif?: boolean;
          rejeu_curseur?: number | null;
          rejeu_debut?: number | null;
          rejeu_fin?: number | null;
          rejeu_intervalle?: Database["public"]["Enums"]["intervalle"] | null;
          rejeu_source?: string | null;
          rejeu_symbole?: string | null;
          solde?: number;
          sommet_equite?: number;
        };
        Relationships: [
          {
            foreignKeyName: "portefeuilles_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      positions: {
        Row: {
          commission_totale: number;
          cycle_id: string | null;
          ferme_le: string | null;
          id: string;
          maj_le: string;
          marge_immobilisee: number;
          motif_sortie: string | null;
          ordre_ouverture_id: string | null;
          origine: Database["public"]["Enums"]["origine_position"];
          ouvert_le: string;
          pnl_latent: number;
          pnl_realise: number | null;
          portefeuille_id: string;
          prix_entree: number;
          prix_sortie: number | null;
          profil_id: string;
          quantite: number;
          sens: Database["public"]["Enums"]["sens_ordre"];
          statut: Database["public"]["Enums"]["statut_position"];
          stop_loss: number | null;
          swap_total: number;
          symbole_id: string;
          take_profit: number | null;
        };
        Insert: {
          commission_totale?: number;
          cycle_id?: string | null;
          ferme_le?: string | null;
          id?: string;
          maj_le?: string;
          marge_immobilisee?: number;
          motif_sortie?: string | null;
          ordre_ouverture_id?: string | null;
          origine?: Database["public"]["Enums"]["origine_position"];
          ouvert_le?: string;
          pnl_latent?: number;
          pnl_realise?: number | null;
          portefeuille_id: string;
          prix_entree: number;
          prix_sortie?: number | null;
          profil_id: string;
          quantite: number;
          sens: Database["public"]["Enums"]["sens_ordre"];
          statut?: Database["public"]["Enums"]["statut_position"];
          stop_loss?: number | null;
          swap_total?: number;
          symbole_id: string;
          take_profit?: number | null;
        };
        Update: {
          commission_totale?: number;
          cycle_id?: string | null;
          ferme_le?: string | null;
          id?: string;
          maj_le?: string;
          marge_immobilisee?: number;
          motif_sortie?: string | null;
          ordre_ouverture_id?: string | null;
          origine?: Database["public"]["Enums"]["origine_position"];
          ouvert_le?: string;
          pnl_latent?: number;
          pnl_realise?: number | null;
          portefeuille_id?: string;
          prix_entree?: number;
          prix_sortie?: number | null;
          profil_id?: string;
          quantite?: number;
          sens?: Database["public"]["Enums"]["sens_ordre"];
          statut?: Database["public"]["Enums"]["statut_position"];
          stop_loss?: number | null;
          swap_total?: number;
          symbole_id?: string;
          take_profit?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "positions_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positions_ordre_ouverture_id_fkey";
            columns: ["ordre_ouverture_id"];
            isOneToOne: false;
            referencedRelation: "ordres";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positions_portefeuille_id_fkey";
            columns: ["portefeuille_id"];
            isOneToOne: false;
            referencedRelation: "portefeuilles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positions_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positions_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      profils: {
        Row: {
          courriel: string;
          cree_le: string;
          fuseau_horaire: string;
          horizon_trading: Database["public"]["Enums"]["horizon_trading"];
          id: string;
          maj_le: string;
          mode_operation: Database["public"]["Enums"]["mode_operation"];
          nom_affichage: string | null;
          plafond_cout_quotidien_usd: number;
          seances_agents: string[];
        };
        Insert: {
          courriel: string;
          cree_le?: string;
          fuseau_horaire?: string;
          horizon_trading?: Database["public"]["Enums"]["horizon_trading"];
          id: string;
          maj_le?: string;
          mode_operation?: Database["public"]["Enums"]["mode_operation"];
          nom_affichage?: string | null;
          plafond_cout_quotidien_usd?: number;
          seances_agents?: string[];
        };
        Update: {
          courriel?: string;
          cree_le?: string;
          fuseau_horaire?: string;
          horizon_trading?: Database["public"]["Enums"]["horizon_trading"];
          id?: string;
          maj_le?: string;
          mode_operation?: Database["public"]["Enums"]["mode_operation"];
          nom_affichage?: string | null;
          plafond_cout_quotidien_usd?: number;
          seances_agents?: string[];
        };
        Relationships: [];
      };
      propositions_ordres: {
        Row: {
          agent_id: string | null;
          cree_le: string;
          cycle_id: string | null;
          decide_le: string | null;
          declenchee_par: string | null;
          id: string;
          intervalle: Database["public"]["Enums"]["intervalle"] | null;
          maj_le: string;
          portefeuille_id: string;
          prix_entree: number | null;
          profil_id: string;
          quantite: number;
          raisonnement: string;
          sens: Database["public"]["Enums"]["sens_ordre"];
          session_id: string | null;
          statut: Database["public"]["Enums"]["statut_proposition"];
          stop_loss: number | null;
          symbole_id: string;
          take_profit: number | null;
          type_ordre: Database["public"]["Enums"]["type_ordre"];
          valide_jusqu_a: string | null;
        };
        Insert: {
          agent_id?: string | null;
          cree_le?: string;
          cycle_id?: string | null;
          decide_le?: string | null;
          declenchee_par?: string | null;
          id?: string;
          intervalle?: Database["public"]["Enums"]["intervalle"] | null;
          maj_le?: string;
          portefeuille_id: string;
          prix_entree?: number | null;
          profil_id: string;
          quantite: number;
          raisonnement: string;
          sens: Database["public"]["Enums"]["sens_ordre"];
          session_id?: string | null;
          statut?: Database["public"]["Enums"]["statut_proposition"];
          stop_loss?: number | null;
          symbole_id: string;
          take_profit?: number | null;
          type_ordre?: Database["public"]["Enums"]["type_ordre"];
          valide_jusqu_a?: string | null;
        };
        Update: {
          agent_id?: string | null;
          cree_le?: string;
          cycle_id?: string | null;
          decide_le?: string | null;
          declenchee_par?: string | null;
          id?: string;
          intervalle?: Database["public"]["Enums"]["intervalle"] | null;
          maj_le?: string;
          portefeuille_id?: string;
          prix_entree?: number | null;
          profil_id?: string;
          quantite?: number;
          raisonnement?: string;
          sens?: Database["public"]["Enums"]["sens_ordre"];
          session_id?: string | null;
          statut?: Database["public"]["Enums"]["statut_proposition"];
          stop_loss?: number | null;
          symbole_id?: string;
          take_profit?: number | null;
          type_ordre?: Database["public"]["Enums"]["type_ordre"];
          valide_jusqu_a?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "propositions_ordres_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propositions_ordres_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propositions_ordres_portefeuille_id_fkey";
            columns: ["portefeuille_id"];
            isOneToOne: false;
            referencedRelation: "portefeuilles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propositions_ordres_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propositions_ordres_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions_autonomes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propositions_ordres_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
      rapports_analyse: {
        Row: {
          agent_id: string;
          confiance: number | null;
          contenu: string;
          cree_le: string;
          cycle_id: string;
          donnees: Json;
          id: string;
          profil_id: string;
          role: Database["public"]["Enums"]["role_agent"];
        };
        Insert: {
          agent_id: string;
          confiance?: number | null;
          contenu: string;
          cree_le?: string;
          cycle_id: string;
          donnees?: Json;
          id?: string;
          profil_id: string;
          role: Database["public"]["Enums"]["role_agent"];
        };
        Update: {
          agent_id?: string;
          confiance?: number | null;
          contenu?: string;
          cree_le?: string;
          cycle_id?: string;
          donnees?: Json;
          id?: string;
          profil_id?: string;
          role?: Database["public"]["Enums"]["role_agent"];
        };
        Relationships: [
          {
            foreignKeyName: "rapports_analyse_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rapports_analyse_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rapports_analyse_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions_autonomes: {
        Row: {
          arretee_le: string | null;
          capital_alloue: number;
          demarree_le: string;
          equite_portefeuille_initiale: number;
          id: string;
          maj_le: string;
          perte_max_pct: number;
          portefeuille_id: string;
          profil_id: string;
          raison_arret: string | null;
          sommet_enveloppe: number;
          statut: Database["public"]["Enums"]["statut_session"];
        };
        Insert: {
          arretee_le?: string | null;
          capital_alloue: number;
          demarree_le?: string;
          equite_portefeuille_initiale: number;
          id?: string;
          maj_le?: string;
          perte_max_pct?: number;
          portefeuille_id: string;
          profil_id: string;
          raison_arret?: string | null;
          sommet_enveloppe: number;
          statut?: Database["public"]["Enums"]["statut_session"];
        };
        Update: {
          arretee_le?: string | null;
          capital_alloue?: number;
          demarree_le?: string;
          equite_portefeuille_initiale?: number;
          id?: string;
          maj_le?: string;
          perte_max_pct?: number;
          portefeuille_id?: string;
          profil_id?: string;
          raison_arret?: string | null;
          sommet_enveloppe?: number;
          statut?: Database["public"]["Enums"]["statut_session"];
        };
        Relationships: [
          {
            foreignKeyName: "sessions_autonomes_portefeuille_id_fkey";
            columns: ["portefeuille_id"];
            isOneToOne: false;
            referencedRelation: "portefeuilles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_autonomes_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      strategies: {
        Row: {
          actif: boolean;
          cas_echec: string;
          classes_actifs: Database["public"]["Enums"]["classe_actif"][];
          code: string;
          conditions_marche: string;
          cree_le: string;
          embedding: string | null;
          famille: string;
          gestion_taille: string;
          horizons: Database["public"]["Enums"]["intervalle"][];
          horizons_trading: Database["public"]["Enums"]["horizon_trading"][];
          id: string;
          maj_le: string;
          methode_embedding: string | null;
          nom: string;
          profil_id: string | null;
          regles_entree: string;
          regles_sortie: string;
          resume: string;
        };
        Insert: {
          actif?: boolean;
          cas_echec: string;
          classes_actifs?: Database["public"]["Enums"]["classe_actif"][];
          code: string;
          conditions_marche: string;
          cree_le?: string;
          embedding?: string | null;
          famille: string;
          gestion_taille: string;
          horizons?: Database["public"]["Enums"]["intervalle"][];
          horizons_trading?: Database["public"]["Enums"]["horizon_trading"][];
          id?: string;
          maj_le?: string;
          methode_embedding?: string | null;
          nom: string;
          profil_id?: string | null;
          regles_entree: string;
          regles_sortie: string;
          resume: string;
        };
        Update: {
          actif?: boolean;
          cas_echec?: string;
          classes_actifs?: Database["public"]["Enums"]["classe_actif"][];
          code?: string;
          conditions_marche?: string;
          cree_le?: string;
          embedding?: string | null;
          famille?: string;
          gestion_taille?: string;
          horizons?: Database["public"]["Enums"]["intervalle"][];
          horizons_trading?: Database["public"]["Enums"]["horizon_trading"][];
          id?: string;
          maj_le?: string;
          methode_embedding?: string | null;
          nom?: string;
          profil_id?: string | null;
          regles_entree?: string;
          regles_sortie?: string;
          resume?: string;
        };
        Relationships: [
          {
            foreignKeyName: "strategies_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      symboles: {
        Row: {
          actif: boolean;
          classe_actif: Database["public"]["Enums"]["classe_actif"];
          code: string;
          commission_par_unite: number;
          cree_le: string;
          decimales: number;
          devise_base: string | null;
          devise_cotation: string;
          fuseau_seance: string;
          horaires_seance: Json;
          id: string;
          levier_max: number;
          libelle: string;
          pas_cotation: number;
          spread_defaut_points: number;
          swap_court_points: number;
          swap_long_points: number;
          taille_contrat: number;
        };
        Insert: {
          actif?: boolean;
          classe_actif: Database["public"]["Enums"]["classe_actif"];
          code: string;
          commission_par_unite?: number;
          cree_le?: string;
          decimales?: number;
          devise_base?: string | null;
          devise_cotation?: string;
          fuseau_seance?: string;
          horaires_seance?: Json;
          id?: string;
          levier_max?: number;
          libelle: string;
          pas_cotation?: number;
          spread_defaut_points?: number;
          swap_court_points?: number;
          swap_long_points?: number;
          taille_contrat?: number;
        };
        Update: {
          actif?: boolean;
          classe_actif?: Database["public"]["Enums"]["classe_actif"];
          code?: string;
          commission_par_unite?: number;
          cree_le?: string;
          decimales?: number;
          devise_base?: string | null;
          devise_cotation?: string;
          fuseau_seance?: string;
          horaires_seance?: Json;
          id?: string;
          levier_max?: number;
          libelle?: string;
          pas_cotation?: number;
          spread_defaut_points?: number;
          swap_court_points?: number;
          swap_long_points?: number;
          taille_contrat?: number;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          cree_le: string;
          description: string | null;
          id: string;
          montant: number;
          ordre_id: string | null;
          portefeuille_id: string;
          position_id: string | null;
          profil_id: string;
          solde_apres: number;
          type: Database["public"]["Enums"]["type_transaction"];
        };
        Insert: {
          cree_le?: string;
          description?: string | null;
          id?: string;
          montant: number;
          ordre_id?: string | null;
          portefeuille_id: string;
          position_id?: string | null;
          profil_id: string;
          solde_apres: number;
          type: Database["public"]["Enums"]["type_transaction"];
        };
        Update: {
          cree_le?: string;
          description?: string | null;
          id?: string;
          montant?: number;
          ordre_id?: string | null;
          portefeuille_id?: string;
          position_id?: string | null;
          profil_id?: string;
          solde_apres?: number;
          type?: Database["public"]["Enums"]["type_transaction"];
        };
        Relationships: [
          {
            foreignKeyName: "transactions_ordre_id_fkey";
            columns: ["ordre_id"];
            isOneToOne: false;
            referencedRelation: "ordres";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_portefeuille_id_fkey";
            columns: ["portefeuille_id"];
            isOneToOne: false;
            referencedRelation: "portefeuilles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_position_id_fkey";
            columns: ["position_id"];
            isOneToOne: false;
            referencedRelation: "positions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
      vues_marche: {
        Row: {
          conviction: number;
          cree_le: string;
          cycle_id: string;
          direction: string;
          horizon: string | null;
          id: string;
          niveau_invalidation: number | null;
          profil_id: string;
          resume: string;
        };
        Insert: {
          conviction: number;
          cree_le?: string;
          cycle_id: string;
          direction: string;
          horizon?: string | null;
          id?: string;
          niveau_invalidation?: number | null;
          profil_id: string;
          resume: string;
        };
        Update: {
          conviction?: number;
          cree_le?: string;
          cycle_id?: string;
          direction?: string;
          horizon?: string | null;
          id?: string;
          niveau_invalidation?: number | null;
          profil_id?: string;
          resume?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vues_marche_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: true;
            referencedRelation: "cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vues_marche_profil_id_fkey";
            columns: ["profil_id"];
            isOneToOne: false;
            referencedRelation: "profils";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      vue_couverture_historique: {
        Row: {
          bougies: number | null;
          classe_actif: Database["public"]["Enums"]["classe_actif"] | null;
          dernier_import: string | null;
          derniere: string | null;
          intervalle: Database["public"]["Enums"]["intervalle"] | null;
          premiere: string | null;
          symbole: string | null;
          symbole_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "chandeliers_symbole_id_fkey";
            columns: ["symbole_id"];
            isOneToOne: false;
            referencedRelation: "symboles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      declencher_kill_switch: {
        Args: { p_raison?: string };
        Returns: undefined;
      };
      lever_kill_switch: { Args: never; Returns: undefined };
      rechercher_lecons: {
        Args: {
          p_embedding: string;
          p_limite?: number;
          p_methode: string;
          p_profil_id?: string;
          p_symbole_id?: string;
        };
        Returns: {
          contenu: string;
          distance: number;
          id: string;
          resultat_pnl: number;
          titre: string;
        }[];
      };
      rechercher_strategies: {
        Args: {
          p_embedding: string;
          p_famille?: string;
          p_horizon?: Database["public"]["Enums"]["horizon_trading"];
          p_limite?: number;
          p_methode: string;
          p_profil_id?: string;
        };
        Returns: {
          cas_echec: string;
          code: string;
          conditions_marche: string;
          distance: number;
          famille: string;
          gestion_taille: string;
          id: string;
          nom: string;
          regles_entree: string;
          regles_sortie: string;
          resume: string;
        }[];
      };
      reinitialiser_firme: {
        Args: {
          p_capital?: number;
          p_conserver_lecons?: boolean;
          p_effacer_historique?: boolean;
        };
        Returns: Json;
      };
      reserver_appel_fournisseur: {
        Args: { p_code: string; p_maintenant?: string; p_profil_id: string };
        Returns: {
          autorise: boolean;
          raison: string;
          reprise_le: string;
        }[];
      };
    };
    Enums: {
      classe_actif:
        | "FOREX"
        | "INDICE"
        | "ACTION"
        | "CRYPTO"
        | "MATIERE_PREMIERE";
      decision_risque: "APPROUVE" | "REDUIT" | "REFUSE";
      declencheur_cycle: "MANUEL" | "PLANIFIE" | "EVENEMENT";
      etat_cycle:
        | "EN_ATTENTE"
        | "COLLECTE_DONNEES"
        | "ANALYSE"
        | "DEBAT"
        | "SYNTHESE"
        | "PROPOSITION"
        | "CONTROLE_RISQUE"
        | "DECISION_PM"
        | "EXECUTION"
        | "JOURNALISATION"
        | "TERMINE"
        | "ECHOUE"
        | "ABANDONNE";
      fenetre_quota: "MINUTE" | "HEURE" | "JOUR" | "MOIS";
      fournisseur_llm:
        | "anthropic"
        | "openai"
        | "google"
        | "mock"
        | "deepseek"
        | "mistral";
      horizon_trading: "SCALPING" | "INTRADAY" | "SWING" | "POSITION";
      intervalle: "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";
      mode_operation:
        | "PAPIER_AUTONOME"
        | "PAPIER_VALIDATION"
        | "PAPIER_CONSEIL"
        | "REEL_VALIDATION";
      niveau_autonomie: "OBSERVATEUR" | "PROPOSITION" | "AUTONOME";
      origine_position: "MANUEL" | "AGENT";
      role_agent:
        | "ANALYSTE_TECHNIQUE"
        | "ANALYSTE_MACRO"
        | "ANALYSTE_FONDAMENTAL"
        | "ANALYSTE_SENTIMENT"
        | "ANALYSTE_VOLATILITE"
        | "CHERCHEUR_HAUSSIER"
        | "CHERCHEUR_BAISSIER"
        | "DIRECTEUR_RECHERCHE"
        | "TRADER"
        | "GESTIONNAIRE_RISQUE"
        | "GESTIONNAIRE_PORTEFEUILLE"
        | "AGENT_REFLEXION";
      sens_ordre: "ACHAT" | "VENTE";
      statut_backtest: "EN_ATTENTE" | "EN_COURS" | "TERMINE" | "ECHOUE";
      statut_ordre:
        | "EN_ATTENTE"
        | "PARTIELLEMENT_REMPLI"
        | "REMPLI"
        | "ANNULE"
        | "EXPIRE"
        | "REJETE";
      statut_position: "OUVERTE" | "FERMEE" | "LIQUIDEE";
      statut_proposition:
        | "PROPOSEE"
        | "EN_CONTROLE_RISQUE"
        | "REJETEE_RISQUE"
        | "EN_ATTENTE_VALIDATION"
        | "REFUSEE_UTILISATEUR"
        | "ACCEPTEE"
        | "EXPIREE"
        | "REFUSEE_PERMISSION";
      statut_session:
        | "EN_COURS"
        | "ARRETEE_UTILISATEUR"
        | "ARRETEE_ENVELOPPE"
        | "ARRETEE_KILL_SWITCH";
      type_ordre: "MARCHE" | "LIMITE" | "STOP";
      type_transaction:
        | "DEPOT"
        | "RETRAIT"
        | "COMMISSION"
        | "SWAP"
        | "PROFIT_PERTE"
        | "AJUSTEMENT";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      classe_actif: ["FOREX", "INDICE", "ACTION", "CRYPTO", "MATIERE_PREMIERE"],
      decision_risque: ["APPROUVE", "REDUIT", "REFUSE"],
      declencheur_cycle: ["MANUEL", "PLANIFIE", "EVENEMENT"],
      etat_cycle: [
        "EN_ATTENTE",
        "COLLECTE_DONNEES",
        "ANALYSE",
        "DEBAT",
        "SYNTHESE",
        "PROPOSITION",
        "CONTROLE_RISQUE",
        "DECISION_PM",
        "EXECUTION",
        "JOURNALISATION",
        "TERMINE",
        "ECHOUE",
        "ABANDONNE",
      ],
      fenetre_quota: ["MINUTE", "HEURE", "JOUR", "MOIS"],
      fournisseur_llm: [
        "anthropic",
        "openai",
        "google",
        "mock",
        "deepseek",
        "mistral",
      ],
      horizon_trading: ["SCALPING", "INTRADAY", "SWING", "POSITION"],
      intervalle: ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"],
      mode_operation: [
        "PAPIER_AUTONOME",
        "PAPIER_VALIDATION",
        "PAPIER_CONSEIL",
        "REEL_VALIDATION",
      ],
      niveau_autonomie: ["OBSERVATEUR", "PROPOSITION", "AUTONOME"],
      origine_position: ["MANUEL", "AGENT"],
      role_agent: [
        "ANALYSTE_TECHNIQUE",
        "ANALYSTE_MACRO",
        "ANALYSTE_FONDAMENTAL",
        "ANALYSTE_SENTIMENT",
        "ANALYSTE_VOLATILITE",
        "CHERCHEUR_HAUSSIER",
        "CHERCHEUR_BAISSIER",
        "DIRECTEUR_RECHERCHE",
        "TRADER",
        "GESTIONNAIRE_RISQUE",
        "GESTIONNAIRE_PORTEFEUILLE",
        "AGENT_REFLEXION",
      ],
      sens_ordre: ["ACHAT", "VENTE"],
      statut_backtest: ["EN_ATTENTE", "EN_COURS", "TERMINE", "ECHOUE"],
      statut_ordre: [
        "EN_ATTENTE",
        "PARTIELLEMENT_REMPLI",
        "REMPLI",
        "ANNULE",
        "EXPIRE",
        "REJETE",
      ],
      statut_position: ["OUVERTE", "FERMEE", "LIQUIDEE"],
      statut_proposition: [
        "PROPOSEE",
        "EN_CONTROLE_RISQUE",
        "REJETEE_RISQUE",
        "EN_ATTENTE_VALIDATION",
        "REFUSEE_UTILISATEUR",
        "ACCEPTEE",
        "EXPIREE",
        "REFUSEE_PERMISSION",
      ],
      statut_session: [
        "EN_COURS",
        "ARRETEE_UTILISATEUR",
        "ARRETEE_ENVELOPPE",
        "ARRETEE_KILL_SWITCH",
      ],
      type_ordre: ["MARCHE", "LIMITE", "STOP"],
      type_transaction: [
        "DEPOT",
        "RETRAIT",
        "COMMISSION",
        "SWAP",
        "PROFIT_PERTE",
        "AJUSTEMENT",
      ],
    },
  },
} as const;
