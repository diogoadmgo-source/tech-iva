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
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      auth_scopes: { Args: never; Returns: unknown[] }
      can_admin: { Args: { p_tenant: string }; Returns: boolean }
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
      current_aal: { Args: never; Returns: string }
      enforce_mfa: { Args: { p_tenant: string }; Returns: undefined }
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
      move_tenant: {
        Args: { p_new_parent: string; p_tenant: string }
        Returns: undefined
      }
      remove_member: {
        Args: { p_tenant: string; p_user: string }
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
      set_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["member_role"]
          p_tenant: string
          p_user: string
        }
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
      text2ltree: { Args: { "": string }; Returns: unknown }
    }
    Enums: {
      invite_status: "pending" | "accepted" | "expired" | "revoked"
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
      invite_status: ["pending", "accepted", "expired", "revoked"],
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
      tenant_kind: ["platform", "channel", "company", "unit"],
      tenant_status: ["active", "suspended", "archived"],
    },
  },
} as const
