export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string | null
          id: string
          kind: string
          payload: Json
          read_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          tenant_id: string
          title: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          tenant_id: string
          title: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key_hash: string
          last_used: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key_hash: string
          last_used?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key_hash?: string
          last_used?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          after: Json | null
          at: string
          before: Json | null
          entity: string
          entity_id: string | null
          id: number
          impersonated_by: string | null
          ip: unknown
          rule_version_id: string | null
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity: string
          entity_id?: string | null
          id?: number
          impersonated_by?: string | null
          ip?: unknown
          rule_version_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity?: string
          entity_id?: string | null
          id?: number
          impersonated_by?: string | null
          ip?: unknown
          rule_version_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          bank_name: string | null
          connected_at: string | null
          external_id: string | null
          id: string
          masked_number: string | null
          provider: string | null
          status: string | null
          tenant_id: string
        }
        Insert: {
          bank_name?: string | null
          connected_at?: string | null
          external_id?: string | null
          id?: string
          masked_number?: string | null
          provider?: string | null
          status?: string | null
          tenant_id: string
        }
        Update: {
          bank_name?: string | null
          connected_at?: string | null
          external_id?: string | null
          id?: string
          masked_number?: string | null
          provider?: string | null
          status?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          account_id: string | null
          amount_cents: number
          booked_at: string
          counterparty_hint: string | null
          description: string | null
          external_id: string | null
          id: string
          match_confidence: number | null
          matched_receivable_id: string | null
          tenant_id: string
        }
        Insert: {
          account_id?: string | null
          amount_cents: number
          booked_at: string
          counterparty_hint?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          match_confidence?: number | null
          matched_receivable_id?: string | null
          tenant_id: string
        }
        Update: {
          account_id?: string | null
          amount_cents?: number
          booked_at?: string
          counterparty_hint?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          match_confidence?: number | null
          matched_receivable_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_matched_receivable_id_fkey"
            columns: ["matched_receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          created_at: string
          created_by: string | null
          credit_pct: number
          id: string
          is_current: boolean
          mrr_pct: number
          note: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credit_pct?: number
          id?: string
          is_current?: boolean
          mrr_pct?: number
          note?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credit_pct?: number
          id?: string
          is_current?: boolean
          mrr_pct?: number
          note?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparties: {
        Row: {
          cnpj: string
          created_at: string
          credit_transfer_pct: number | null
          id: string
          meta: Json
          name: string | null
          purchase_share_pct: number | null
          regime: Database["public"]["Enums"]["regime_kind"]
          regime_checked_at: string | null
          regime_source: string | null
          revenue_share_pct: number | null
          risk_flag: string | null
          role: Database["public"]["Enums"]["party_role"]
          tenant_id: string
        }
        Insert: {
          cnpj: string
          created_at?: string
          credit_transfer_pct?: number | null
          id?: string
          meta?: Json
          name?: string | null
          purchase_share_pct?: number | null
          regime?: Database["public"]["Enums"]["regime_kind"]
          regime_checked_at?: string | null
          regime_source?: string | null
          revenue_share_pct?: number | null
          risk_flag?: string | null
          role?: Database["public"]["Enums"]["party_role"]
          tenant_id: string
        }
        Update: {
          cnpj?: string
          created_at?: string
          credit_transfer_pct?: number | null
          id?: string
          meta?: Json
          name?: string | null
          purchase_share_pct?: number | null
          regime?: Database["public"]["Enums"]["regime_kind"]
          regime_checked_at?: string | null
          regime_source?: string | null
          revenue_share_pct?: number | null
          risk_flag?: string | null
          role?: Database["public"]["Enums"]["party_role"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterparties_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          connected_at: string | null
          error: string | null
          id: string
          kind: string
          last_sync: string | null
          secret_ref: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          config?: Json
          connected_at?: string | null
          error?: string | null
          id?: string
          kind: string
          last_sync?: string | null
          secret_ref?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          config?: Json
          connected_at?: string | null
          error?: string | null
          id?: string
          kind?: string
          last_sync?: string | null
          secret_ref?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["invite_status"]
          tenant_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          base_cents: number | null
          calc_memory: Json | null
          cbs_cents: number | null
          cclasstrib: string | null
          credit_cents: number | null
          credit_eligible: boolean | null
          cst: string | null
          description: string | null
          ibs_cents: number | null
          id: string
          inconsistency: Json | null
          invoice_id: string
          is_cents: number | null
          line: number
          ncm: string | null
          product_id: string | null
          qty: number | null
          tenant_id: string
          unit: string | null
          unit_price_cents: number | null
        }
        Insert: {
          base_cents?: number | null
          calc_memory?: Json | null
          cbs_cents?: number | null
          cclasstrib?: string | null
          credit_cents?: number | null
          credit_eligible?: boolean | null
          cst?: string | null
          description?: string | null
          ibs_cents?: number | null
          id?: string
          inconsistency?: Json | null
          invoice_id: string
          is_cents?: number | null
          line: number
          ncm?: string | null
          product_id?: string | null
          qty?: number | null
          tenant_id: string
          unit?: string | null
          unit_price_cents?: number | null
        }
        Update: {
          base_cents?: number | null
          calc_memory?: Json | null
          cbs_cents?: number | null
          cclasstrib?: string | null
          credit_cents?: number | null
          credit_eligible?: boolean | null
          cst?: string | null
          description?: string | null
          ibs_cents?: number | null
          id?: string
          inconsistency?: Json | null
          invoice_id?: string
          is_cents?: number | null
          line?: number
          ncm?: string | null
          product_id?: string | null
          qty?: number | null
          tenant_id?: string
          unit?: string | null
          unit_price_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          access_key: string
          cbs_cents: number | null
          counterparty_id: string | null
          credit_cents: number | null
          direction: Database["public"]["Enums"]["invoice_direction"]
          ibs_cents: number | null
          id: string
          inconsistencies: Json
          ingested_at: string
          is_cents: number | null
          issued_at: string
          model: string
          number: string | null
          raw_xml_path: string | null
          rule_version_id: string | null
          series: string | null
          status: string
          tenant_id: string
          total_cents: number
        }
        Insert: {
          access_key: string
          cbs_cents?: number | null
          counterparty_id?: string | null
          credit_cents?: number | null
          direction: Database["public"]["Enums"]["invoice_direction"]
          ibs_cents?: number | null
          id?: string
          inconsistencies?: Json
          ingested_at?: string
          is_cents?: number | null
          issued_at: string
          model: string
          number?: string | null
          raw_xml_path?: string | null
          rule_version_id?: string | null
          series?: string | null
          status?: string
          tenant_id: string
          total_cents: number
        }
        Update: {
          access_key?: string
          cbs_cents?: number | null
          counterparty_id?: string | null
          credit_cents?: number | null
          direction?: Database["public"]["Enums"]["invoice_direction"]
          ibs_cents?: number | null
          id?: string
          inconsistencies?: Json
          ingested_at?: string
          is_cents?: number | null
          issued_at?: string
          model?: string
          number?: string | null
          raw_xml_path?: string | null
          rule_version_id?: string | null
          series?: string | null
          status?: string
          tenant_id?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          message: string | null
          params: Json
          progress: number | null
          queued_at: string | null
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          worker: string | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          message?: string | null
          params?: Json
          progress?: number | null
          queued_at?: string | null
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          worker?: string | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          params?: Json
          progress?: number | null
          queued_at?: string | null
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          code: string
          features: Json
          id: string
          limits: Json
          name: string
          price_cents: number
        }
        Insert: {
          active?: boolean
          code: string
          features?: Json
          id?: string
          limits?: Json
          name: string
          price_cents?: number
        }
        Update: {
          active?: boolean
          code?: string
          features?: Json
          id?: string
          limits?: Json
          name?: string
          price_cents?: number
        }
        Relationships: []
      }
      price_lines: {
        Row: {
          below_floor: boolean | null
          cost_cents: number | null
          counterparty_id: string | null
          current_price_cents: number | null
          delta_pct: number | null
          floor_price_cents: number | null
          id: string
          input_credit_cents: number | null
          memory: Json | null
          product_id: string
          scenario_id: string
          target_price_cents: number | null
          tenant_id: string
        }
        Insert: {
          below_floor?: boolean | null
          cost_cents?: number | null
          counterparty_id?: string | null
          current_price_cents?: number | null
          delta_pct?: number | null
          floor_price_cents?: number | null
          id?: string
          input_credit_cents?: number | null
          memory?: Json | null
          product_id: string
          scenario_id: string
          target_price_cents?: number | null
          tenant_id: string
        }
        Update: {
          below_floor?: boolean | null
          cost_cents?: number | null
          counterparty_id?: string | null
          current_price_cents?: number | null
          delta_pct?: number | null
          floor_price_cents?: number | null
          id?: string
          input_credit_cents?: number | null
          memory?: Json | null
          product_id?: string
          scenario_id?: string
          target_price_cents?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_lines_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lines_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "price_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      price_scenarios: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assumptions: Json
          created_at: string | null
          fiscal_year: number
          id: string
          name: string
          rule_version_id: string | null
          status: string
          target_margin: number
          tenant_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assumptions?: Json
          created_at?: string | null
          fiscal_year: number
          id?: string
          name: string
          rule_version_id?: string | null
          status?: string
          target_margin: number
          tenant_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assumptions?: Json
          created_at?: string | null
          fiscal_year?: number
          id?: string
          name?: string
          rule_version_id?: string | null
          status?: string
          target_margin?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_scenarios_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean | null
          cclasstrib_default: string | null
          cost_cents: number | null
          cst_default: string | null
          current_price_cents: number | null
          id: string
          name: string
          ncm: string | null
          sku: string | null
          source: string | null
          tenant_id: string
        }
        Insert: {
          active?: boolean | null
          cclasstrib_default?: string | null
          cost_cents?: number | null
          cst_default?: string | null
          current_price_cents?: number | null
          id?: string
          name: string
          ncm?: string | null
          sku?: string | null
          source?: string | null
          tenant_id: string
        }
        Update: {
          active?: boolean | null
          cclasstrib_default?: string | null
          cost_cents?: number | null
          cst_default?: string | null
          current_price_cents?: number | null
          id?: string
          name?: string
          ncm?: string | null
          sku?: string | null
          source?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          last_tenant: string | null
          locale: string
          phone: string | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          last_tenant?: string | null
          locale?: string
          phone?: string | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          last_tenant?: string | null
          locale?: string
          phone?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_tenant_fkey"
            columns: ["last_tenant"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables: {
        Row: {
          amount_cents: number
          confidence: number
          due_date: string
          expected_date: string | null
          id: string
          installment: number | null
          invoice_id: string | null
          paid_at: string | null
          source: string
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          confidence?: number
          due_date: string
          expected_date?: string | null
          id?: string
          installment?: number | null
          invoice_id?: string | null
          paid_at?: string | null
          source?: string
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          confidence?: number
          due_date?: string
          expected_date?: string | null
          id?: string
          installment?: number | null
          invoice_id?: string | null
          paid_at?: string | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivables_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      regime_simulations: {
        Row: {
          id: string
          inputs: Json
          next_window: string | null
          recommendation: string | null
          report_path: string | null
          results: Json
          rule_version_id: string | null
          run_at: string | null
          tenant_id: string
        }
        Insert: {
          id?: string
          inputs: Json
          next_window?: string | null
          recommendation?: string | null
          report_path?: string | null
          results: Json
          rule_version_id?: string | null
          run_at?: string | null
          tenant_id: string
        }
        Update: {
          id?: string
          inputs?: Json
          next_window?: string | null
          recommendation?: string | null
          report_path?: string | null
          results?: Json
          rule_version_id?: string | null
          run_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regime_simulations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_versions: {
        Row: {
          calc_version: string
          cclasstrib_version: string
          id: string
          is_current: boolean
          notes: string | null
          published_at: string | null
          published_by: string | null
          valid_from: string
        }
        Insert: {
          calc_version: string
          cclasstrib_version: string
          id?: string
          is_current?: boolean
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          valid_from: string
        }
        Update: {
          calc_version?: string
          cclasstrib_version?: string
          id?: string
          is_current?: boolean
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          valid_from?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          ends_at: string | null
          id: string
          meta: Json
          plan_id: string
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          ends_at?: string | null
          id?: string
          meta?: Json
          plan_id: string
          started_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          ends_at?: string | null
          id?: string
          meta?: Json
          plan_id?: string
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_cash_events: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_cash_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_cash_events_202508: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202509: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202510: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202511: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202512: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202601: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202602: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202603: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202604: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202605: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202606: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202607: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202608: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202609: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202610: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202611: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202612: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202701: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202702: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202703: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202704: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202705: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202706: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202707: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202708: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202709: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202710: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202711: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202712: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202801: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202802: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202803: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202804: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202805: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202806: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202807: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202808: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202809: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202810: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202811: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202812: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202901: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202902: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202903: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202904: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202905: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202906: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_202907: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tax_cash_events_default: {
        Row: {
          amount_cents: number
          computed_at: string
          confidence: number
          event_date: string
          id: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id: string | null
          ref_invoice_id: string | null
          rule_version_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          computed_at?: string
          confidence?: number
          event_date: string
          id?: number
          kind: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          computed_at?: string
          confidence?: number
          event_date?: string
          id?: number
          kind?: Database["public"]["Enums"]["cash_event_kind"]
          ref_contract_id?: string | null
          ref_invoice_id?: string | null
          rule_version_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          brand: Json
          cnpj: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["tenant_kind"]
          level: number
          name: string
          parent_id: string | null
          path: unknown
          settings: Json
          slug: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
        }
        Insert: {
          brand?: Json
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["tenant_kind"]
          level: number
          name: string
          parent_id?: string | null
          path: unknown
          settings?: Json
          slug?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Update: {
          brand?: Json
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["tenant_kind"]
          level?: number
          name?: string
          parent_id?: string | null
          path?: unknown
          settings?: Json
          slug?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      mv_cash_timeline: {
        Row: {
          confidence: number | null
          credit_in_cents: number | null
          net_cents: number | null
          tax_out_cents: number | null
          tenant_id: string | null
          week: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_cash_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_credit_offer: {
        Args: { p_offer: string; p_signature_ref: string }
        Returns: string
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      ack_alert: { Args: { p_alert: string }; Returns: undefined }
      alert_prefs_default: { Args: never; Returns: Json }
      approve_price_scenario: {
        Args: { p_scenario: string }
        Returns: undefined
      }
      auth_scopes: { Args: never; Returns: unknown[] }
      can_admin: { Args: { p_tenant: string }; Returns: boolean }
      can_credit: { Args: { p_tenant: string }; Returns: boolean }
      can_price: { Args: { p_tenant: string }; Returns: boolean }
      cancel_job: { Args: { p_job: string }; Returns: undefined }
      chain_map: {
        Args: {
          p_filters?: Json
          p_role?: Database["public"]["Enums"]["party_role"]
          p_tenant: string
        }
        Returns: {
          cnpj: string
          credit_lost_cents: number
          credit_transfer_pct: number
          id: string
          name: string
          regime: Database["public"]["Enums"]["regime_kind"]
          semaphore: string
          share_pct: number
          suggested_action: string
          total_cents: number
        }[]
      }
      channel_commission_statement: {
        Args: { p_month?: string; p_tenant: string }
        Returns: Json
      }
      channel_portfolio: {
        Args: { p_filters?: Json; p_tenant: string }
        Returns: {
          cnpj: string
          gap_30_cents: number
          gap_90_cents: number
          last_ingest: string
          name: string
          next_window: string
          open_alerts: number
          plan_code: string
          tenant_id: string
        }[]
      }
      counterparty_detail: {
        Args: { p_id: string; p_tenant: string }
        Returns: Json
      }
      create_rule_version: {
        Args: {
          p_calc_version: string
          p_cclasstrib_version: string
          p_notes?: string
          p_valid_from: string
        }
        Returns: string
      }
      create_tenant: {
        Args: {
          p_cnpj?: string
          p_kind: Database["public"]["Enums"]["tenant_kind"]
          p_name: string
          p_parent: string
          p_slug?: string
        }
        Returns: string
      }
      credit_contract_detail: { Args: { p_contract: string }; Returns: Json }
      credit_contracts: { Args: { p_tenant: string }; Returns: Json[] }
      credit_generate_offers: { Args: { p_tenant: string }; Returns: number }
      credit_offer_detail: { Args: { p_offer: string }; Returns: Json }
      credit_offers: { Args: { p_tenant: string }; Returns: Json[] }
      current_aal: { Args: never; Returns: string }
      dashboard_cash: {
        Args: { p_horizon_days?: number; p_tenant: string }
        Returns: Json
      }
      enforce_mfa: { Args: { p_tenant: string }; Returns: undefined }
      enqueue_job: {
        Args: { p_kind: string; p_params?: Json; p_tenant: string }
        Returns: string
      }
      ensure_tce_partition: { Args: { p_date: string }; Returns: undefined }
      get_alert_prefs: { Args: { p_tenant: string }; Returns: Json }
      in_scope: { Args: { p_tenant: string }; Returns: boolean }
      invite_user: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_tenant: string
        }
        Returns: {
          invitation_id: string
          token: string
        }[]
      }
      is_platform: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_platform_ops: { Args: never; Returns: boolean }
      job_kind_allowed: {
        Args: { p_kind: string; p_tenant: string }
        Returns: boolean
      }
      log_audit: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_entity: string
          p_entity_id: string
          p_rule?: string
          p_tenant: string
        }
        Returns: undefined
      }
      ltree_label: { Args: { p: string }; Returns: string }
      mark_renegotiate: {
        Args: { p_note?: string; p_parties: string[]; p_tenant: string }
        Returns: number
      }
      move_tenant: {
        Args: { p_new_parent: string; p_tenant: string }
        Returns: undefined
      }
      platform_ops_overview: { Args: never; Returns: Json }
      price_credit_factor: {
        Args: { p_regime: Database["public"]["Enums"]["regime_kind"] }
        Returns: number
      }
      price_scenario_compute: { Args: { p_scenario: string }; Returns: number }
      price_scenario_create: {
        Args: {
          p_counterparty?: string
          p_fiscal_year: number
          p_name: string
          p_target_margin: number
          p_tenant: string
          p_var_exp_pct?: number
        }
        Returns: string
      }
      price_scenario_detail: { Args: { p_scenario: string }; Returns: Json }
      publish_rule_version: {
        Args: { p_dry_run?: boolean; p_id: string }
        Returns: Json
      }
      refresh_cash_timeline: { Args: never; Returns: undefined }
      regime_iva_rate: { Args: { p_year: number }; Returns: number }
      regime_next_window: { Args: { p_from?: string }; Returns: string }
      regime_wallet_summary: { Args: { p_tenant: string }; Returns: Json }
      remove_member: {
        Args: { p_tenant: string; p_user: string }
        Returns: undefined
      }
      require_aal2: { Args: never; Returns: undefined }
      resolve_alert: {
        Args: { p_alert: string; p_note?: string }
        Returns: undefined
      }
      retry_job: { Args: { p_job: string }; Returns: string }
      role_in: {
        Args: { p_tenant: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      role_requires_mfa: {
        Args: { p_role: Database["public"]["Enums"]["member_role"] }
        Returns: boolean
      }
      rule_reprocess_progress: { Args: { p_id: string }; Returns: Json }
      rule_versions_list: { Args: never; Returns: Json[] }
      run_regime_simulation: {
        Args: { p_inputs?: Json; p_tenant: string }
        Returns: string
      }
      set_alert_prefs: {
        Args: { p_prefs: Json; p_tenant: string }
        Returns: Json
      }
      set_commission_rule: {
        Args: {
          p_credit_pct: number
          p_mrr_pct: number
          p_note?: string
          p_tenant: string
        }
        Returns: string
      }
      set_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["member_role"]
          p_tenant: string
          p_user: string
        }
        Returns: undefined
      }
      set_regime_manual: {
        Args: {
          p_party: string
          p_reason: string
          p_regime: Database["public"]["Enums"]["regime_kind"]
          p_tenant: string
        }
        Returns: undefined
      }
      share_regime_simulation: {
        Args: { p_note?: string; p_simulation: string }
        Returns: undefined
      }
      tenant_members: {
        Args: { p_tenant: string }
        Returns: {
          avatar_url: string
          created_at: string
          email: string
          full_name: string
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          user_id: string
        }[]
      }
      update_product_price: {
        Args: {
          p_cost_cents?: number
          p_current_price_cents?: number
          p_product: string
        }
        Returns: undefined
      }
      weekly_digest_batch: { Args: { p_weekday?: number }; Returns: Json[] }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      cash_event_kind:
        | "tax_out"
        | "credit_in"
        | "provision"
        | "credit_advance"
        | "loan_in"
        | "loan_out"
      invite_status: "pending" | "accepted" | "expired" | "revoked"
      invoice_direction: "out" | "in"
      job_status: "queued" | "running" | "done" | "failed" | "canceled"
      member_role:
        | "platform_admin"
        | "platform_ops"
        | "platform_risk"
        | "channel_admin"
        | "channel_analyst"
        | "owner"
        | "finance"
        | "commercial"
        | "viewer"
      party_role: "customer" | "supplier" | "both"
      regime_kind:
        | "simples"
        | "simples_hibrido"
        | "presumido"
        | "real"
        | "mei"
        | "pf"
        | "imune"
        | "desconhecido"
      tenant_kind: "platform" | "channel" | "company" | "unit"
      tenant_status: "active" | "suspended" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_severity: ["info", "warning", "critical"],
      cash_event_kind: [
        "tax_out",
        "credit_in",
        "provision",
        "credit_advance",
        "loan_in",
        "loan_out",
      ],
      invite_status: ["pending", "accepted", "expired", "revoked"],
      invoice_direction: ["out", "in"],
      job_status: ["queued", "running", "done", "failed", "canceled"],
      member_role: [
        "platform_admin",
        "platform_ops",
        "platform_risk",
        "channel_admin",
        "channel_analyst",
        "owner",
        "finance",
        "commercial",
        "viewer",
      ],
      party_role: ["customer", "supplier", "both"],
      regime_kind: [
        "simples",
        "simples_hibrido",
        "presumido",
        "real",
        "mei",
        "pf",
        "imune",
        "desconhecido",
      ],
      tenant_kind: ["platform", "channel", "company", "unit"],
      tenant_status: ["active", "suspended", "archived"],
    },
  },
} as const
