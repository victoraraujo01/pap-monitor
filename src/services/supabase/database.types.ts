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
      fund_bond_lots: {
        Row: {
          bond_id: string
          id: string
          is_active: boolean | null
          purchase_date: string
          purchase_price: number
          quantity: number
          transaction_id: string | null
        }
        Insert: {
          bond_id: string
          id?: string
          is_active?: boolean | null
          purchase_date: string
          purchase_price: number
          quantity: number
          transaction_id?: string | null
        }
        Update: {
          bond_id?: string
          id?: string
          is_active?: boolean | null
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
          status: Database["public"]["Enums"]["obligation_status"] | null
        }
        Insert: {
          amount_expected?: number | null
          id?: string
          profile_id: string
          reference_month: string
          status?: Database["public"]["Enums"]["obligation_status"] | null
        }
        Update: {
          amount_expected?: number | null
          id?: string
          profile_id?: string
          reference_month?: string
          status?: Database["public"]["Enums"]["obligation_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_obligations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          id: string
          profile_id: string | null
          quota_price: number
          quotas_amount: number
          status: Database["public"]["Enums"]["transaction_status"] | null
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Insert: {
          amount_brl: number
          approved_by?: string | null
          created_at?: string | null
          id?: string
          profile_id?: string | null
          quota_price: number
          quotas_amount: number
          status?: Database["public"]["Enums"]["transaction_status"] | null
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Update: {
          amount_brl?: number
          approved_by?: string | null
          created_at?: string | null
          id?: string
          profile_id?: string | null
          quota_price?: number
          quotas_amount?: number
          status?: Database["public"]["Enums"]["transaction_status"] | null
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
            foreignKeyName: "transactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      obligation_status: "PENDING" | "PAID"
      transaction_status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"
      transaction_type: "APORTE" | "RESGATE_PESSOAL" | "DESPESA_PAIS"
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
      transaction_type: ["APORTE", "RESGATE_PESSOAL", "DESPESA_PAIS"],
      user_role: ["COTISTA", "ADMIN"],
    },
  },
} as const

