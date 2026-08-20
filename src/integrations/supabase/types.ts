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
      billing_webhook_events: {
        Row: {
          environment: string
          event_id: string
          event_type: string
          received_at: string
          subscription_id: string | null
          tenant_id: string | null
        }
        Insert: {
          environment: string
          event_id: string
          event_type: string
          received_at?: string
          subscription_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          environment?: string
          event_id?: string
          event_type?: string
          received_at?: string
          subscription_id?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      calc_rule_cache: {
        Row: {
          aliq_cbs: number
          aliq_ibs_mun: number
          aliq_ibs_uf: number
          aliq_is: number
          ano: number
          base_legal: string | null
          calculado_em: string
          cclasstrib: string
          classificacao: string
          cst: string
          memoria: Json | null
          municipio: string
          permite_credito: boolean
          reducao_pct: number
          rule_version: string
          uf_destino: string
          uf_origem: string
        }
        Insert: {
          aliq_cbs?: number
          aliq_ibs_mun?: number
          aliq_ibs_uf?: number
          aliq_is?: number
          ano: number
          base_legal?: string | null
          calculado_em?: string
          cclasstrib: string
          classificacao?: string
          cst: string
          memoria?: Json | null
          municipio?: string
          permite_credito?: boolean
          reducao_pct?: number
          rule_version: string
          uf_destino?: string
          uf_origem?: string
        }
        Update: {
          aliq_cbs?: number
          aliq_ibs_mun?: number
          aliq_ibs_uf?: number
          aliq_is?: number
          ano?: number
          base_legal?: string | null
          calculado_em?: string
          cclasstrib?: string
          classificacao?: string
          cst?: string
          memoria?: Json | null
          municipio?: string
          permite_credito?: boolean
          reducao_pct?: number
          rule_version?: string
          uf_destino?: string
          uf_origem?: string
        }
        Relationships: []
      }
      calc_simulations: {
        Row: {
          calc_version: string | null
          created_at: string
          created_by: string | null
          id: string
          inputs: Json
          memory: Json | null
          nome: string | null
          results: Json
          rule_version_id: string | null
          share_expires_at: string | null
          share_token: string | null
          tenant_id: string
        }
        Insert: {
          calc_version?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inputs: Json
          memory?: Json | null
          nome?: string | null
          results: Json
          rule_version_id?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          tenant_id: string
        }
        Update: {
          calc_version?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inputs?: Json
          memory?: Json | null
          nome?: string | null
          results?: Json
          rule_version_id?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calc_simulations_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calc_simulations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cnpj_registry: {
        Row: {
          abertura: string | null
          bairro: string | null
          capital_social_cents: number | null
          cep: string | null
          cnae_principal: string | null
          cnae_principal_desc: string | null
          cnae_secundarios: Json
          cnpj: string
          complemento: string | null
          email: string | null
          fetched_at: string
          logradouro: string | null
          matriz: boolean | null
          mei_desde: string | null
          mei_optante: boolean | null
          municipio: string | null
          natureza_juridica: string | null
          nome_fantasia: string | null
          numero: string | null
          porte: string | null
          raw: Json | null
          razao_social: string | null
          simples_ate: string | null
          simples_desde: string | null
          simples_optante: boolean | null
          situacao: string | null
          situacao_data: string | null
          source: string
          telefone: string | null
          uf: string | null
        }
        Insert: {
          abertura?: string | null
          bairro?: string | null
          capital_social_cents?: number | null
          cep?: string | null
          cnae_principal?: string | null
          cnae_principal_desc?: string | null
          cnae_secundarios?: Json
          cnpj: string
          complemento?: string | null
          email?: string | null
          fetched_at?: string
          logradouro?: string | null
          matriz?: boolean | null
          mei_desde?: string | null
          mei_optante?: boolean | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          raw?: Json | null
          razao_social?: string | null
          simples_ate?: string | null
          simples_desde?: string | null
          simples_optante?: boolean | null
          situacao?: string | null
          situacao_data?: string | null
          source?: string
          telefone?: string | null
          uf?: string | null
        }
        Update: {
          abertura?: string | null
          bairro?: string | null
          capital_social_cents?: number | null
          cep?: string | null
          cnae_principal?: string | null
          cnae_principal_desc?: string | null
          cnae_secundarios?: Json
          cnpj?: string
          complemento?: string | null
          email?: string | null
          fetched_at?: string
          logradouro?: string | null
          matriz?: boolean | null
          mei_desde?: string | null
          mei_optante?: boolean | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          raw?: Json | null
          razao_social?: string | null
          simples_ate?: string | null
          simples_desde?: string | null
          simples_optante?: boolean | null
          situacao?: string | null
          situacao_data?: string | null
          source?: string
          telefone?: string | null
          uf?: string | null
        }
        Relationships: []
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
      credential_usage: {
        Row: {
          credential_id: string
          detalhe: string | null
          finalidade: string
          id: number
          job_id: string | null
          sucesso: boolean
          tenant_id: string
          usado_em: string
          worker: string | null
        }
        Insert: {
          credential_id: string
          detalhe?: string | null
          finalidade: string
          id?: number
          job_id?: string | null
          sucesso: boolean
          tenant_id: string
          usado_em?: string
          worker?: string | null
        }
        Update: {
          credential_id?: string
          detalhe?: string | null
          finalidade?: string
          id?: number
          job_id?: string | null
          sucesso?: boolean
          tenant_id?: string
          usado_em?: string
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_usage_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "integration_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_usage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dfe_events: {
        Row: {
          id: number
          nsu: string
          received_at: string
          schema: string
          tenant_id: string
          xml: string
        }
        Insert: {
          id?: never
          nsu: string
          received_at?: string
          schema: string
          tenant_id: string
          xml: string
        }
        Update: {
          id?: never
          nsu?: string
          received_at?: string
          schema?: string
          tenant_id?: string
          xml?: string
        }
        Relationships: [
          {
            foreignKeyName: "dfe_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dfe_pending_manifest: {
        Row: {
          chave: string
          cstat: number | null
          detectado_em: string
          emitente: string | null
          manifestado_em: string | null
          tenant_id: string
          valor_cents: number | null
        }
        Insert: {
          chave: string
          cstat?: number | null
          detectado_em?: string
          emitente?: string | null
          manifestado_em?: string | null
          tenant_id: string
          valor_cents?: number | null
        }
        Update: {
          chave?: string
          cstat?: number | null
          detectado_em?: string
          emitente?: string | null
          manifestado_em?: string | null
          tenant_id?: string
          valor_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dfe_pending_manifest_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dfe_sync_state: {
        Row: {
          last_stat: number | null
          max_nsu: string
          synced_at: string | null
          tenant_id: string
          ult_nsu: string
        }
        Insert: {
          last_stat?: number | null
          max_nsu?: string
          synced_at?: string | null
          tenant_id: string
          ult_nsu?: string
        }
        Update: {
          last_stat?: number | null
          max_nsu?: string
          synced_at?: string | null
          tenant_id?: string
          ult_nsu?: string
        }
        Relationships: [
          {
            foreignKeyName: "dfe_sync_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          created_at: string
          created_by: string | null
          falhas_consecutivas: number
          finalidades: string[]
          fingerprint: string | null
          id: string
          kind: Database["public"]["Enums"]["credential_kind"]
          last_error: string | null
          last_used_at: string | null
          not_after: string | null
          not_before: string | null
          provider: string
          revoked_at: string | null
          revoked_by: string | null
          scopes: string[]
          secret_ref: string | null
          status: Database["public"]["Enums"]["credential_status"]
          subject_cn: string | null
          subject_cnpj: string | null
          tenant_id: string
          uploaded_by_role: string | null
          uploaded_on_behalf: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          falhas_consecutivas?: number
          finalidades?: string[]
          fingerprint?: string | null
          id?: string
          kind: Database["public"]["Enums"]["credential_kind"]
          last_error?: string | null
          last_used_at?: string | null
          not_after?: string | null
          not_before?: string | null
          provider: string
          revoked_at?: string | null
          revoked_by?: string | null
          scopes?: string[]
          secret_ref?: string | null
          status?: Database["public"]["Enums"]["credential_status"]
          subject_cn?: string | null
          subject_cnpj?: string | null
          tenant_id: string
          uploaded_by_role?: string | null
          uploaded_on_behalf?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          falhas_consecutivas?: number
          finalidades?: string[]
          fingerprint?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["credential_kind"]
          last_error?: string | null
          last_used_at?: string | null
          not_after?: string | null
          not_before?: string | null
          provider?: string
          revoked_at?: string | null
          revoked_by?: string | null
          scopes?: string[]
          secret_ref?: string | null
          status?: Database["public"]["Enums"]["credential_status"]
          subject_cn?: string | null
          subject_cnpj?: string | null
          tenant_id?: string
          uploaded_by_role?: string | null
          uploaded_on_behalf?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_tenant_id_fkey"
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
          attempts: number
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          lease_until: string | null
          message: string | null
          next_attempt_at: string | null
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
          attempts?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          lease_until?: string | null
          message?: string | null
          next_attempt_at?: string | null
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
          attempts?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          lease_until?: string | null
          message?: string | null
          next_attempt_at?: string | null
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
      platform_notices: {
        Row: {
          active: boolean
          body: string
          key: string
          scope: string
          severity: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          body: string
          key: string
          scope: string
          severity?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          body?: string
          key?: string
          scope?: string
          severity?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
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
      prontidao_item: {
        Row: {
          chave: string
          concluido: boolean
          concluido_em: string | null
          concluido_por: string | null
          id: string
          observacao: string | null
          tenant_id: string
        }
        Insert: {
          chave: string
          concluido?: boolean
          concluido_em?: string | null
          concluido_por?: string | null
          id?: string
          observacao?: string | null
          tenant_id: string
        }
        Update: {
          chave?: string
          concluido?: boolean
          concluido_em?: string | null
          concluido_por?: string | null
          id?: string
          observacao?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prontidao_item_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables: {
        Row: {
          amount_cents: number
          antecipacao_ref: string | null
          antecipado_em: string | null
          arranjo: Database["public"]["Enums"]["arranjo_pagamento"]
          confidence: number
          due_date: string
          expected_date: string | null
          id: string
          installment: number | null
          invoice_id: string | null
          paid_at: string | null
          source: string
          tenant_id: string
          tributo_em_aberto_cents: number | null
          valor_pago_cents: number | null
        }
        Insert: {
          amount_cents: number
          antecipacao_ref?: string | null
          antecipado_em?: string | null
          arranjo?: Database["public"]["Enums"]["arranjo_pagamento"]
          confidence?: number
          due_date: string
          expected_date?: string | null
          id?: string
          installment?: number | null
          invoice_id?: string | null
          paid_at?: string | null
          source?: string
          tenant_id: string
          tributo_em_aberto_cents?: number | null
          valor_pago_cents?: number | null
        }
        Update: {
          amount_cents?: number
          antecipacao_ref?: string | null
          antecipado_em?: string | null
          arranjo?: Database["public"]["Enums"]["arranjo_pagamento"]
          confidence?: number
          due_date?: string
          expected_date?: string | null
          id?: string
          installment?: number | null
          invoice_id?: string | null
          paid_at?: string | null
          source?: string
          tenant_id?: string
          tributo_em_aberto_cents?: number | null
          valor_pago_cents?: number | null
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
      rtc_api_quota: {
        Row: {
          cnpj8: string
          dia: string
          downloads: number
          solicitacoes: number
          ultimo_erro: string | null
        }
        Insert: {
          cnpj8: string
          dia: string
          downloads?: number
          solicitacoes?: number
          ultimo_erro?: string | null
        }
        Update: {
          cnpj8?: string
          dia?: string
          downloads?: number
          solicitacoes?: number
          ultimo_erro?: string | null
        }
        Relationships: []
      }
      rtc_apuracao: {
        Row: {
          competencia: string
          creditos_cents: number | null
          debitos_cents: number | null
          download_em: string | null
          erro: string | null
          id: string
          intencao_ressarcimento: boolean
          natureza_resultado:
            | Database["public"]["Enums"]["apuracao_natureza"]
            | null
          natureza_saldo:
            | Database["public"]["Enums"]["apuracao_natureza"]
            | null
          pagamentos_cents: number | null
          payload: Json | null
          recebido_em: string | null
          resultado_cents: number | null
          saldo_atualizado_cents: number | null
          saldo_cents: number | null
          situacao: Database["public"]["Enums"]["apuracao_situacao"] | null
          solicitado_em: string
          status: string
          tenant_id: string
          tiquete: string | null
          tiquete_download: string | null
          tiquete_solicitacao: string | null
          webhook_recebido_em: string | null
          webhook_ref: string | null
        }
        Insert: {
          competencia: string
          creditos_cents?: number | null
          debitos_cents?: number | null
          download_em?: string | null
          erro?: string | null
          id?: string
          intencao_ressarcimento?: boolean
          natureza_resultado?:
            | Database["public"]["Enums"]["apuracao_natureza"]
            | null
          natureza_saldo?:
            | Database["public"]["Enums"]["apuracao_natureza"]
            | null
          pagamentos_cents?: number | null
          payload?: Json | null
          recebido_em?: string | null
          resultado_cents?: number | null
          saldo_atualizado_cents?: number | null
          saldo_cents?: number | null
          situacao?: Database["public"]["Enums"]["apuracao_situacao"] | null
          solicitado_em?: string
          status?: string
          tenant_id: string
          tiquete?: string | null
          tiquete_download?: string | null
          tiquete_solicitacao?: string | null
          webhook_recebido_em?: string | null
          webhook_ref?: string | null
        }
        Update: {
          competencia?: string
          creditos_cents?: number | null
          debitos_cents?: number | null
          download_em?: string | null
          erro?: string | null
          id?: string
          intencao_ressarcimento?: boolean
          natureza_resultado?:
            | Database["public"]["Enums"]["apuracao_natureza"]
            | null
          natureza_saldo?:
            | Database["public"]["Enums"]["apuracao_natureza"]
            | null
          pagamentos_cents?: number | null
          payload?: Json | null
          recebido_em?: string | null
          resultado_cents?: number | null
          saldo_atualizado_cents?: number | null
          saldo_cents?: number | null
          situacao?: Database["public"]["Enums"]["apuracao_situacao"] | null
          solicitado_em?: string
          status?: string
          tenant_id?: string
          tiquete?: string | null
          tiquete_download?: string | null
          tiquete_solicitacao?: string | null
          webhook_recebido_em?: string | null
          webhook_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rtc_apuracao_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rtc_apuracao_conta: {
        Row: {
          apuracao_id: string
          caminho: string
          conta: string
          id: number
          natureza: Database["public"]["Enums"]["apuracao_natureza"]
          nivel: number
          ordem: number
          payload: Json | null
          tem_detalhe: boolean
          tenant_id: string
          valor_cents: number
          visao: string
        }
        Insert: {
          apuracao_id: string
          caminho: string
          conta: string
          id?: number
          natureza?: Database["public"]["Enums"]["apuracao_natureza"]
          nivel?: number
          ordem?: number
          payload?: Json | null
          tem_detalhe?: boolean
          tenant_id: string
          valor_cents?: number
          visao: string
        }
        Update: {
          apuracao_id?: string
          caminho?: string
          conta?: string
          id?: number
          natureza?: Database["public"]["Enums"]["apuracao_natureza"]
          nivel?: number
          ordem?: number
          payload?: Json | null
          tem_detalhe?: boolean
          tenant_id?: string
          valor_cents?: number
          visao?: string
        }
        Relationships: [
          {
            foreignKeyName: "rtc_apuracao_conta_apuracao_id_fkey"
            columns: ["apuracao_id"]
            isOneToOne: false
            referencedRelation: "rtc_apuracao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rtc_apuracao_conta_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rtc_class_trib: {
        Row: {
          atualizado_em: string
          base_legal: string | null
          cclasstrib: string
          cst: string
          descricao: string | null
          efeito: string | null
          fonte: string
          permite_credito: boolean | null
          reducao_pct: number | null
          vigencia_fim: string | null
          vigencia_inicio: string | null
        }
        Insert: {
          atualizado_em?: string
          base_legal?: string | null
          cclasstrib: string
          cst: string
          descricao?: string | null
          efeito?: string | null
          fonte?: string
          permite_credito?: boolean | null
          reducao_pct?: number | null
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Update: {
          atualizado_em?: string
          base_legal?: string | null
          cclasstrib?: string
          cst?: string
          descricao?: string | null
          efeito?: string | null
          fonte?: string
          permite_credito?: boolean | null
          reducao_pct?: number | null
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Relationships: []
      }
      rtc_debito: {
        Row: {
          apuracao_id: string
          autorizado_em: string | null
          cbs_extinto_cents: number
          cbs_nao_extinto_cents: number
          cbs_total_cents: number
          chave_dfe: string | null
          competencia: string
          emitido_em: string | null
          ext_credito_cbs_cents: number
          ext_credito_piscofins_cents: number
          ext_pagamento_cents: number
          ext_prescricao_cents: number
          grupo: Database["public"]["Enums"]["apuracao_grupo"]
          id: number
          modelo_dfe: string | null
          ni_adquirente: string | null
          ni_emitente: string | null
          numero_dfe: string | null
          payload: Json | null
          registrado_em: string | null
          situacao: Database["public"]["Enums"]["debito_situacao"] | null
          tenant_id: string
          tipos_pagamento: string[]
        }
        Insert: {
          apuracao_id: string
          autorizado_em?: string | null
          cbs_extinto_cents?: number
          cbs_nao_extinto_cents?: number
          cbs_total_cents?: number
          chave_dfe?: string | null
          competencia: string
          emitido_em?: string | null
          ext_credito_cbs_cents?: number
          ext_credito_piscofins_cents?: number
          ext_pagamento_cents?: number
          ext_prescricao_cents?: number
          grupo: Database["public"]["Enums"]["apuracao_grupo"]
          id?: number
          modelo_dfe?: string | null
          ni_adquirente?: string | null
          ni_emitente?: string | null
          numero_dfe?: string | null
          payload?: Json | null
          registrado_em?: string | null
          situacao?: Database["public"]["Enums"]["debito_situacao"] | null
          tenant_id: string
          tipos_pagamento?: string[]
        }
        Update: {
          apuracao_id?: string
          autorizado_em?: string | null
          cbs_extinto_cents?: number
          cbs_nao_extinto_cents?: number
          cbs_total_cents?: number
          chave_dfe?: string | null
          competencia?: string
          emitido_em?: string | null
          ext_credito_cbs_cents?: number
          ext_credito_piscofins_cents?: number
          ext_pagamento_cents?: number
          ext_prescricao_cents?: number
          grupo?: Database["public"]["Enums"]["apuracao_grupo"]
          id?: number
          modelo_dfe?: string | null
          ni_adquirente?: string | null
          ni_emitente?: string | null
          numero_dfe?: string | null
          payload?: Json | null
          registrado_em?: string | null
          situacao?: Database["public"]["Enums"]["debito_situacao"] | null
          tenant_id?: string
          tipos_pagamento?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "rtc_debito_apuracao_id_fkey"
            columns: ["apuracao_id"]
            isOneToOne: false
            referencedRelation: "rtc_apuracao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rtc_debito_tenant_id_fkey"
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
          buyer_id: string | null
          cancel_at_period_end: boolean
          current_period_end: string | null
          current_period_start: string | null
          ends_at: string | null
          environment: string
          id: string
          meta: Json
          paddle_customer_id: string | null
          paddle_price_id: string | null
          paddle_product_id: string | null
          paddle_subscription_id: string | null
          plan_id: string
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          buyer_id?: string | null
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          ends_at?: string | null
          environment?: string
          id?: string
          meta?: Json
          paddle_customer_id?: string | null
          paddle_price_id?: string | null
          paddle_product_id?: string | null
          paddle_subscription_id?: string | null
          plan_id: string
          started_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          buyer_id?: string | null
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          ends_at?: string | null
          environment?: string
          id?: string
          meta?: Json
          paddle_customer_id?: string | null
          paddle_price_id?: string | null
          paddle_product_id?: string | null
          paddle_subscription_id?: string | null
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
      tenant_features: {
        Row: {
          enabled: boolean
          enabled_at: string | null
          enabled_by: string | null
          feature: string
          note: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature: string
          note?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature?: string
          note?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      xml_validations: {
        Row: {
          access_key: string | null
          calc_version: string | null
          created_at: string
          created_by: string | null
          filename: string | null
          id: string
          inconsistencias: Json
          modelo: string | null
          tenant_id: string
          total_itens: number | null
          valido: boolean
        }
        Insert: {
          access_key?: string | null
          calc_version?: string | null
          created_at?: string
          created_by?: string | null
          filename?: string | null
          id?: string
          inconsistencias?: Json
          modelo?: string | null
          tenant_id: string
          total_itens?: number | null
          valido: boolean
        }
        Update: {
          access_key?: string | null
          calc_version?: string | null
          created_at?: string
          created_by?: string | null
          filename?: string | null
          id?: string
          inconsistencias?: Json
          modelo?: string | null
          tenant_id?: string
          total_itens?: number | null
          valido?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "xml_validations_tenant_id_fkey"
            columns: ["tenant_id"]
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
      apply_calc_rules: {
        Args: { p_batch?: number; p_rule_version: string; p_tenant: string }
        Returns: Json
      }
      apply_registry_to_counterparties: {
        Args: { p_tenant: string }
        Returns: Json
      }
      approve_price_scenario: {
        Args: { p_scenario: string }
        Returns: undefined
      }
      apuracao_detalhe: {
        Args: { p_competencia: string; p_tenant: string }
        Returns: Json
      }
      apuracao_divergencia: {
        Args: { p_competencia: string; p_tenant: string }
        Returns: Json
      }
      apuracao_situacao_em: {
        Args: { p_competencia: string; p_ref?: string }
        Returns: Database["public"]["Enums"]["apuracao_situacao"]
      }
      apuracoes_lista: {
        Args: { p_limite?: number; p_tenant: string }
        Returns: {
          competencia: string
          natureza_resultado: Database["public"]["Enums"]["apuracao_natureza"]
          recebido_em: string
          resultado_cents: number
          saldo_atualizado_cents: number
          situacao: Database["public"]["Enums"]["apuracao_situacao"]
        }[]
      }
      arranjo_tem_proporcionalidade: {
        Args: { p: Database["public"]["Enums"]["arranjo_pagamento"] }
        Returns: boolean
      }
      arranjo_tem_split: {
        Args: { p: Database["public"]["Enums"]["arranjo_pagamento"] }
        Returns: boolean
      }
      auth_scopes: { Args: never; Returns: unknown[] }
      billing_events_scope: {
        Args: { p_limit?: number; p_tenant: string }
        Returns: {
          action: string
          actor_role: string
          amount: string
          at: string
          currency: string
          event_id: number
          reference: string
          status_after: string
          status_before: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      billing_subscriptions_scope: {
        Args: { p_tenant: string }
        Returns: {
          cancel_at_period_end: boolean
          cnpj: string
          current_period_end: string
          current_period_start: string
          ends_at: string
          environment: string
          paddle_subscription_id: string
          plan_code: string
          plan_name: string
          price_cents: number
          started_at: string
          status: string
          subscription_id: string
          tenant_id: string
          tenant_kind: Database["public"]["Enums"]["tenant_kind"]
          tenant_name: string
        }[]
      }
      calc_rule_cache_upsert: { Args: { p: Json }; Returns: number }
      can_admin: { Args: { p_tenant: string }; Returns: boolean }
      can_credit: { Args: { p_tenant: string }; Returns: boolean }
      can_price: { Args: { p_tenant: string }; Returns: boolean }
      cancel_job: { Args: { p_job: string }; Returns: undefined }
      certificado_confere_titular: {
        Args: { p_subject_cnpj: string; p_tenant: string }
        Returns: boolean
      }
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
      check_credential_anomalies: { Args: never; Returns: number }
      check_expiring_credentials: { Args: never; Returns: number }
      checklist_prontidao: { Args: { p_tenant: string }; Returns: Json }
      claim_job: {
        Args: { p_kinds: string[]; p_lease_seconds?: number; p_worker: string }
        Returns: {
          attempts: number
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          lease_until: string | null
          message: string | null
          next_attempt_at: string | null
          params: Json
          progress: number | null
          queued_at: string | null
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          worker: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cnpj_lookup: { Args: { p_cnpj: string }; Returns: Json }
      cnpj_registry_upsert: { Args: { p: Json }; Returns: undefined }
      comparar_modalidades: {
        Args: { p_horizon_days?: number; p_tenant: string }
        Returns: Json
      }
      conciliacao_documentos: {
        Args: {
          p_competencia: string
          p_so_divergentes?: boolean
          p_tenant: string
        }
        Returns: {
          chave_dfe: string
          contraparte: string
          diferenca_cents: number
          grupo: Database["public"]["Enums"]["apuracao_grupo"]
          nao_extinto_cents: number
          nosso_cents: number
          numero_dfe: string
          receita_cents: number
          situacao: Database["public"]["Enums"]["debito_situacao"]
        }[]
      }
      conciliacao_documentos_page: {
        Args: {
          p_competencia: string
          p_dir?: string
          p_limit?: number
          p_offset?: number
          p_order?: string
          p_search?: string
          p_so_divergentes?: boolean
          p_tenant: string
        }
        Returns: {
          chave_dfe: string
          contraparte: string
          debito_id: number
          diferenca_cents: number
          grupo: Database["public"]["Enums"]["apuracao_grupo"]
          nao_extinto_cents: number
          nosso_cents: number
          numero_dfe: string
          receita_cents: number
          situacao: Database["public"]["Enums"]["debito_situacao"]
          total_count: number
        }[]
      }
      counterparties_missing_registry: {
        Args: { p_tenant: string; p_ttl_days?: number }
        Returns: {
          cnpj: string
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
      credential_allows: {
        Args: { p_credential: string; p_finalidade: string }
        Returns: boolean
      }
      credential_usage_report: {
        Args: { p_dias?: number; p_tenant: string }
        Returns: {
          detalhe: string
          finalidade: string
          fingerprint: string
          subject_cn: string
          sucesso: boolean
          usado_em: string
        }[]
      }
      credentials_status: {
        Args: { p_tenant: string }
        Returns: {
          created_at: string
          dias_de_validade: number
          dias_para_expirar: number
          falhas_consecutivas: number
          finalidades: string[]
          fingerprint: string
          id: string
          kind: Database["public"]["Enums"]["credential_kind"]
          last_error: string
          last_used_at: string
          last_used_finalidade: string
          not_after: string
          not_before: string
          provider: string
          status: Database["public"]["Enums"]["credential_status"]
          subject_cn: string
          subject_cnpj: string
          titular_confere: boolean
          uploaded_by_name: string
          uploaded_by_role: string
          uploaded_on_behalf: boolean
        }[]
      }
      credit_contract_detail: { Args: { p_contract: string }; Returns: Json }
      credit_contracts: { Args: { p_tenant: string }; Returns: Json[] }
      credit_generate_offers: { Args: { p_tenant: string }; Returns: number }
      credit_offer_detail: { Args: { p_offer: string }; Returns: Json }
      credit_offers: { Args: { p_tenant: string }; Returns: Json[] }
      credit_pct_from_regime: {
        Args: { p_regime: Database["public"]["Enums"]["regime_kind"] }
        Returns: number
      }
      current_aal: { Args: never; Returns: string }
      dashboard_cash: {
        Args: { p_horizon_days?: number; p_tenant: string }
        Returns: Json
      }
      data_saida_imposto: {
        Args: {
          p_emissao: string
          p_modalidade: Database["public"]["Enums"]["modalidade_recolhimento"]
          p_recebimento: string
        }
        Returns: string
      }
      enforce_mfa: { Args: { p_tenant: string }; Returns: undefined }
      enforce_regime_role: { Args: { p_tenant: string }; Returns: undefined }
      enqueue_job: {
        Args: { p_kind: string; p_params?: Json; p_tenant: string }
        Returns: string
      }
      ensure_tce_partition: { Args: { p_date: string }; Returns: undefined }
      extincao_resumo: {
        Args: { p_competencia: string; p_tenant: string }
        Returns: Json
      }
      feature_enabled: {
        Args: { p_feature: string; p_tenant: string }
        Returns: boolean
      }
      finalidades_validas: {
        Args: { p_finalidades: string[] }
        Returns: boolean
      }
      ganho_antecipacao: {
        Args: { p_dias?: number; p_tenant: string }
        Returns: Json
      }
      get_alert_prefs: { Args: { p_tenant: string }; Returns: Json }
      has_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["member_role"][]
          p_tenant: string
        }
        Returns: boolean
      }
      in_scope: { Args: { p_tenant: string }; Returns: boolean }
      ingest_checkpoint: { Args: { p_tenant: string }; Returns: Json }
      ingest_invoices_batch: {
        Args: { p_batch: Json; p_tenant: string }
        Returns: Json
      }
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
      log_billing_event: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_tenant: string
        }
        Returns: undefined
      }
      log_credential_use: {
        Args: {
          p_credential: string
          p_detalhe?: string
          p_finalidade: string
          p_job?: string
          p_sucesso: boolean
          p_worker?: string
        }
        Returns: undefined
      }
      ltree_label: { Args: { p: string }; Returns: string }
      marcar_prontidao: {
        Args: {
          p_chave: string
          p_concluido: boolean
          p_observacao?: string
          p_tenant: string
        }
        Returns: undefined
      }
      mark_renegotiate: {
        Args: { p_note?: string; p_parties: string[]; p_tenant: string }
        Returns: number
      }
      move_tenant: {
        Args: { p_new_parent: string; p_tenant: string }
        Returns: undefined
      }
      my_tenants: {
        Args: never
        Returns: {
          cnpj: string
          credito_habilitado: boolean
          id: string
          kind: Database["public"]["Enums"]["tenant_kind"]
          level: number
          membership_direta: boolean
          name: string
          papel: Database["public"]["Enums"]["member_role"]
          parent_id: string
          path: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
        }[]
      }
      notices_for: {
        Args: { p_scope: string }
        Returns: {
          body: string
          key: string
          severity: string
          title: string
        }[]
      }
      pending_calc_signatures: {
        Args: { p_limit?: number; p_rule_version: string; p_tenant: string }
        Returns: {
          ano: number
          cclasstrib: string
          classificacao: string
          cst: string
          itens: number
          municipio: string
          uf_destino: string
          uf_origem: string
        }[]
      }
      plan_for_price: { Args: { p_price_id: string }; Returns: string }
      platform_features: {
        Args: { p_feature?: string }
        Returns: {
          cnpj: string
          enabled: boolean
          enabled_at: string
          kind: Database["public"]["Enums"]["tenant_kind"]
          note: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      platform_identity: { Args: never; Returns: Json }
      platform_ops_overview: { Args: never; Returns: Json }
      premissa_credito_dias: { Args: never; Returns: number }
      premissa_dia_vencimento: { Args: never; Returns: number }
      premissa_inicio_vigencia: { Args: never; Returns: string }
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
      project_cash_sql: {
        Args: {
          p_horizon_days?: number
          p_modalidade?: Database["public"]["Enums"]["modalidade_recolhimento"]
          p_tenant: string
        }
        Returns: Json
      }
      publish_rule_version: {
        Args: { p_dry_run?: boolean; p_id: string }
        Returns: Json
      }
      refresh_cash_timeline: { Args: never; Returns: undefined }
      regime_from_registry: {
        Args: { p_mei: boolean; p_natureza: string; p_simples: boolean }
        Returns: Database["public"]["Enums"]["regime_kind"]
      }
      regime_iva_rate: { Args: { p_year: number }; Returns: number }
      regime_next_window: { Args: { p_from?: string }; Returns: string }
      regime_wallet_summary: { Args: { p_tenant: string }; Returns: Json }
      register_credential: {
        Args: {
          p_caller?: string
          p_finalidades?: string[]
          p_fingerprint?: string
          p_kind: Database["public"]["Enums"]["credential_kind"]
          p_not_after?: string
          p_not_before?: string
          p_provider: string
          p_scopes?: string[]
          p_secret_ref: string
          p_subject_cn?: string
          p_subject_cnpj?: string
          p_tenant: string
          p_uploaded_by_role?: string
          p_uploaded_on_behalf?: boolean
        }
        Returns: string
      }
      remove_member: {
        Args: { p_tenant: string; p_user: string }
        Returns: undefined
      }
      report_job: {
        Args: {
          p_error?: string
          p_job: string
          p_lease_seconds?: number
          p_message?: string
          p_progress?: number
          p_result?: Json
          p_status: Database["public"]["Enums"]["job_status"]
        }
        Returns: undefined
      }
      require_aal2: { Args: never; Returns: undefined }
      require_feature: {
        Args: { p_feature: string; p_tenant: string }
        Returns: undefined
      }
      resolve_alert: {
        Args: { p_alert: string; p_note?: string }
        Returns: undefined
      }
      retry_job: { Args: { p_job: string }; Returns: string }
      revoke_credential: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      role_in: {
        Args: { p_tenant: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      role_requires_mfa: {
        Args: { p_role: Database["public"]["Enums"]["member_role"] }
        Returns: boolean
      }
      rtc_apuracao_expirar_pendentes: { Args: never; Returns: number }
      rtc_apuracao_falhar: {
        Args: { p_devolver_cota?: boolean; p_erro: string; p_id: string }
        Returns: Json
      }
      rtc_apuracao_ingest_json: {
        Args: { p_apuracao: string; p_json: Json }
        Returns: Json
      }
      rtc_apuracao_pendentes_download: {
        Args: never
        Returns: {
          cnpj: string
          competencia: string
          id: string
          tenant_id: string
          tiquete: string
        }[]
      }
      rtc_apuracao_receber_tiquete: {
        Args: { p_payload: Json; p_ref: string }
        Returns: Json
      }
      rtc_apuracao_solicitar: {
        Args: { p_competencia: string; p_origem?: string; p_tenant: string }
        Returns: Json
      }
      rtc_apuracao_upsert: {
        Args: { p_payload: Json; p_tenant: string }
        Returns: string
      }
      rtc_class_trib_upsert: { Args: { p: Json }; Returns: number }
      rtc_credential_state: { Args: { p_tenant: string }; Returns: Json }
      rtc_quota_status: { Args: { p_tenant: string }; Returns: Json }
      rtc_quota_take: {
        Args: { p_cnpj: string; p_kind: string; p_origem?: string }
        Returns: Json
      }
      rule_reprocess_progress: { Args: { p_id: string }; Returns: Json }
      rule_versions_list: { Args: never; Returns: Json[] }
      run_regime_simulation: {
        Args: { p_inputs?: Json; p_tenant: string }
        Returns: string
      }
      save_simulation: {
        Args: {
          p_calc_version: string
          p_inputs: Json
          p_memory: Json
          p_nome: string
          p_results: Json
          p_tenant: string
        }
        Returns: string
      }
      save_xml_validation: {
        Args: {
          p_access_key: string
          p_calc_version: string
          p_filename: string
          p_inconsistencias: Json
          p_modelo: string
          p_tenant: string
          p_total_itens: number
          p_valido: boolean
        }
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
      set_platform_identity: {
        Args: { p_cnpj: string; p_nome: string; p_razao: string }
        Returns: undefined
      }
      set_premissa_dia_vencimento: {
        Args: { p_dia: number }
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
      set_tenant_feature: {
        Args: {
          p_enabled: boolean
          p_feature: string
          p_note?: string
          p_tenant: string
        }
        Returns: undefined
      }
      set_tenant_modalidade: {
        Args: {
          p_modalidade: Database["public"]["Enums"]["modalidade_recolhimento"]
          p_tenant: string
        }
        Returns: undefined
      }
      share_regime_simulation: {
        Args: { p_note?: string; p_simulation: string }
        Returns: undefined
      }
      share_simulation: { Args: { p_id: string }; Returns: Json }
      so_digitos: { Args: { p: string }; Returns: string }
      split_segregado_cents: {
        Args: {
          p_arranjo: Database["public"]["Enums"]["arranjo_pagamento"]
          p_tributo_em_aberto_cents?: number
          p_tributo_referencia_cents: number
          p_valor_original_cents: number
          p_valor_pago_cents: number
        }
        Returns: number
      }
      tenant_context: { Args: { p_tenant: string }; Returns: Json }
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
      tenant_modalidade: {
        Args: { p_tenant: string }
        Returns: Database["public"]["Enums"]["modalidade_recolhimento"]
      }
      tenant_plan: { Args: { p_tenant: string }; Returns: Json }
      tenant_plans_scope: { Args: { p_tenant: string }; Returns: Json }
      unshare_simulation: { Args: { p_id: string }; Returns: undefined }
      update_product_price: {
        Args: {
          p_cost_cents?: number
          p_current_price_cents?: number
          p_product: string
        }
        Returns: undefined
      }
      validate_class_trib: {
        Args: { p_cclasstrib: string; p_cst: string; p_data?: string }
        Returns: Json
      }
      validation_summary: {
        Args: { p_dias?: number; p_tenant: string }
        Returns: Json
      }
      validation_top_issues: {
        Args: { p_dias?: number; p_tenant: string }
        Returns: {
          codigo: string
          descricao: string
          documentos: number
          ocorrencias: number
          ultimo: string
        }[]
      }
      weekly_digest_batch: { Args: { p_weekday?: number }; Returns: Json[] }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      apuracao_grupo: "corrente" | "ajuste" | "extemporaneo"
      apuracao_natureza: "credor" | "devedor" | "neutro"
      apuracao_situacao: "em_andamento" | "periodo_ajuste" | "concluida"
      arranjo_pagamento:
        | "boleto"
        | "pix_dinamico"
        | "pix_automatico"
        | "pix_estatico"
        | "ted"
        | "tef"
        | "cartao"
        | "dinheiro"
        | "outro"
        | "desconhecido"
      cash_event_kind:
        | "tax_out"
        | "credit_in"
        | "provision"
        | "credit_advance"
        | "loan_in"
        | "loan_out"
      credential_kind: "procuracao" | "api_key" | "certificado_a1"
      credential_status: "pendente" | "ativa" | "expirada" | "revogada" | "erro"
      debito_situacao:
        | "aguardando_processamento"
        | "nao_extinto"
        | "extinto_parcial"
        | "extinto_total"
        | "cancelado"
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
      modalidade_recolhimento: "apuracao" | "rad" | "split"
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
      apuracao_grupo: ["corrente", "ajuste", "extemporaneo"],
      apuracao_natureza: ["credor", "devedor", "neutro"],
      apuracao_situacao: ["em_andamento", "periodo_ajuste", "concluida"],
      arranjo_pagamento: [
        "boleto",
        "pix_dinamico",
        "pix_automatico",
        "pix_estatico",
        "ted",
        "tef",
        "cartao",
        "dinheiro",
        "outro",
        "desconhecido",
      ],
      cash_event_kind: [
        "tax_out",
        "credit_in",
        "provision",
        "credit_advance",
        "loan_in",
        "loan_out",
      ],
      credential_kind: ["procuracao", "api_key", "certificado_a1"],
      credential_status: ["pendente", "ativa", "expirada", "revogada", "erro"],
      debito_situacao: [
        "aguardando_processamento",
        "nao_extinto",
        "extinto_parcial",
        "extinto_total",
        "cancelado",
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
      modalidade_recolhimento: ["apuracao", "rad", "split"],
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
