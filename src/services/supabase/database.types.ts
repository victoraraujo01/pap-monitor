export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      bond_price_history: {
        Row: {
          bond_id: string
          date: string
          price: number
        }
        Insert: {
          bond_id: string
          date: string
          price: number
        }
        Update: {
          bond_id?: string
          date?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "bond_price_history_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "treasury_bonds"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_bond_lots: {
        Row: {
          bond_id: string
          id: string
          is_active: boolean | null
          is_opening: boolean
          original_quantity: number | null
          purchase_date: string
          purchase_price: number
          quantity: number
          transaction_id: string | null
        }
        Insert: {
          bond_id: string
          id?: string
          is_active?: boolean | null
          is_opening?: boolean
          original_quantity?: number | null
          purchase_date: string
          purchase_price: number
          quantity: number
          transaction_id?: string | null
        }
        Update: {
          bond_id?: string
          id?: string
          is_active?: boolean | null
          is_opening?: boolean
          original_quantity?: number | null
          purchase_date?: string
          purchase_price?: number
          quantity?: number
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fund_bond_lots_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "treasury_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fund_bond_lots_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_obligations: {
        Row: {
          amount_expected: number | null
          id: string
          profile_id: string
          reference_month: string
          status_override:
            | Database["public"]["Enums"]["obligation_status"]
            | null
        }
        Insert: {
          amount_expected?: number | null
          id?: string
          profile_id: string
          reference_month: string
          status_override?:
            | Database["public"]["Enums"]["obligation_status"]
            | null
        }
        Update: {
          amount_expected?: number | null
          id?: string
          profile_id?: string
          reference_month?: string
          status_override?:
            | Database["public"]["Enums"]["obligation_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_obligations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_obligations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_cotista_balance"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      pl_history: {
        Row: {
          date: string
          id: string
          quota_price: number
          total_pl_brl: number
          total_quotas: number
        }
        Insert: {
          date: string
          id?: string
          quota_price: number
          total_pl_brl: number
          total_quotas: number
        }
        Update: {
          date?: string
          id?: string
          quota_price?: number
          total_pl_brl?: number
          total_quotas?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          name: string
          role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          id: string
          name: string
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_brl: number
          approved_by: string | null
          created_at: string | null
          event_date: string
          id: string
          is_opening: boolean
          profile_id: string | null
          quantity: number | null
          quota_price: number
          quotas_amount: number
          reposition_amount: number
          source_bond_id: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          target_bond_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Insert: {
          amount_brl: number
          approved_by?: string | null
          created_at?: string | null
          event_date?: string
          id?: string
          is_opening?: boolean
          profile_id?: string | null
          quantity?: number | null
          quota_price: number
          quotas_amount: number
          reposition_amount?: number
          source_bond_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          target_bond_id?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Update: {
          amount_brl?: number
          approved_by?: string | null
          created_at?: string | null
          event_date?: string
          id?: string
          is_opening?: boolean
          profile_id?: string | null
          quantity?: number | null
          quota_price?: number
          quotas_amount?: number
          reposition_amount?: number
          source_bond_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          target_bond_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "transactions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_cotista_balance"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "transactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_cotista_balance"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "transactions_source_bond_id_fkey"
            columns: ["source_bond_id"]
            isOneToOne: false
            referencedRelation: "treasury_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_target_bond_id_fkey"
            columns: ["target_bond_id"]
            isOneToOne: false
            referencedRelation: "treasury_bonds"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_bonds: {
        Row: {
          api_reference_name: string
          current_price: number | null
          display_name: string | null
          id: string
          is_available_for_purchase: boolean | null
          updated_at: string | null
        }
        Insert: {
          api_reference_name: string
          current_price?: number | null
          display_name?: string | null
          id?: string
          is_available_for_purchase?: boolean | null
          updated_at?: string | null
        }
        Update: {
          api_reference_name?: string
          current_price?: number | null
          display_name?: string | null
          id?: string
          is_available_for_purchase?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_cotista_balance: {
        Row: {
          balance: number | null
          profile_id: string | null
          repayment_outstanding: number | null
          reposed_total: number | null
          total_expected: number | null
          total_paid: number | null
          withdrawn_total: number | null
        }
        Relationships: []
      }
      v_monthly_obligations: {
        Row: {
          amount_expected: number | null
          cum_expected: number | null
          id: string | null
          profile_id: string | null
          reference_month: string | null
          status: Database["public"]["Enums"]["obligation_status"] | null
          status_override:
            | Database["public"]["Enums"]["obligation_status"]
            | null
          total_paid: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_obligations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_obligations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_cotista_balance"
            referencedColumns: ["profile_id"]
          },
        ]
      }
    }
    Functions: {
      apply_event_changes: {
        Args: { p_caller_id: string; p_changes: Json }
        Returns: Json
      }
      approve_expense: {
        Args: { p_approver_id: string; p_transaction_id: string }
        Returns: undefined
      }
      clear_all_movements: { Args: { p_admin_id: string }; Returns: undefined }
      delete_transaction: {
        Args: { p_caller_id: string; p_transaction_id: string }
        Returns: undefined
      }
      generate_monthly_obligations: {
        Args: { p_admin_id: string; p_amount?: number }
        Returns: number
      }
      pap_autorebuild: { Args: never; Returns: undefined }
      pap_delete_transaction_core: {
        Args: { p_caller_id: string; p_transaction_id: string }
        Returns: undefined
      }
      pap_emit_pl: {
        Args: { p_date: string; p_total_quotas: number }
        Returns: undefined
      }
      pap_generate_obligations: { Args: { p_amount: number }; Returns: number }
      pap_ir_rate: { Args: { days: number }; Returns: number }
      pap_latest_quota_price: { Args: never; Returns: number }
      pap_liquidate_fifo: {
        Args: { p_bond_id: string; p_quantity: number }
        Returns: undefined
      }
      pap_portfolio_net_value: { Args: { p_date: string }; Returns: number }
      pap_price_on: {
        Args: { p_bond_id: string; p_date: string }
        Returns: number
      }
      pap_rebuild_history: { Args: never; Returns: undefined }
      pap_require_admin: { Args: { p_profile_id: string }; Returns: undefined }
      pap_require_admin_or_owner: {
        Args: { p_caller_id: string; p_owner_id: string }
        Returns: undefined
      }
      pap_run_daily_pl: { Args: never; Returns: undefined }
      pap_update_transaction_core: {
        Args: {
          p_amount_brl: number
          p_bond_id: string
          p_caller_id: string
          p_event_date: string
          p_quantity: number
          p_transaction_id: string
        }
        Returns: undefined
      }
      rebuild_fund_history: { Args: { p_admin_id: string }; Returns: undefined }
      recalculate_pl: { Args: { p_date?: string }; Returns: undefined }
      register_aporte: {
        Args: {
          p_amount_brl: number
          p_bond_id: string
          p_event_date?: string
          p_profile_id: string
          p_quantity: number
          p_reposition_amount?: number
        }
        Returns: string
      }
      register_reinvestment: {
        Args: {
          p_event_date?: string
          p_profile_id: string
          p_source_bond_id: string
          p_source_quantity: number
          p_targets: Json
        }
        Returns: string
      }
      reinvestment_source_proceeds: {
        Args: { p_bond_id: string; p_date?: string; p_quantity: number }
        Returns: Json
      }
      reject_expense: {
        Args: { p_approver_id: string; p_transaction_id: string }
        Returns: undefined
      }
      request_withdrawal: {
        Args: {
          p_amount_brl: number
          p_bond_id: string
          p_direct?: boolean
          p_event_date?: string
          p_profile_id: string
          p_quantity: number
          p_type: Database["public"]["Enums"]["transaction_type"]
        }
        Returns: string
      }
      set_obligation_status: {
        Args: {
          p_admin_id: string
          p_obligation_id: string
          p_status?: Database["public"]["Enums"]["obligation_status"]
        }
        Returns: undefined
      }
      set_opening_balance: {
        Args: {
          p_admin_id: string
          p_date: string
          p_lots: Json
          p_quota_price?: number
          p_quotas: Json
        }
        Returns: undefined
      }
      update_bond_price_history: { Args: { p_rows: Json }; Returns: number }
      update_bond_prices: { Args: { p_prices: Json }; Returns: number }
      update_transaction: {
        Args: {
          p_amount_brl: number
          p_bond_id: string
          p_caller_id: string
          p_event_date: string
          p_quantity: number
          p_transaction_id: string
        }
        Returns: undefined
      }
      upsert_treasury_bond: {
        Args: {
          p_admin_id: string
          p_api_reference_name: string
          p_current_price?: number
          p_display_name?: string
          p_is_available?: boolean
        }
        Returns: string
      }
    }
    Enums: {
      obligation_status: "PENDING" | "PAID"
      transaction_status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"
      transaction_type:
        | "APORTE"
        | "RESGATE_PESSOAL"
        | "DESPESA_PAIS"
        | "REINVESTIMENTO"
      user_role: "COTISTA" | "ADMIN"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      obligation_status: ["PENDING", "PAID"],
      transaction_status: ["PENDING_APPROVAL", "APPROVED", "REJECTED"],
      transaction_type: [
        "APORTE",
        "RESGATE_PESSOAL",
        "DESPESA_PAIS",
        "REINVESTIMENTO",
      ],
      user_role: ["COTISTA", "ADMIN"],
    },
  },
} as const

