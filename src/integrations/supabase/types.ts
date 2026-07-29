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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      academies: {
        Row: {
          address: string | null
          bank_account: string
          bank_branch: string
          bank_code: string
          bank_name: string
          city: string | null
          created_at: string
          finance_contact_name: string
          finance_whatsapp: string
          finance_document_display: string | null
          asaas_environment_label: string
          id: string
          name: string
          slug: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank_account?: string
          bank_branch?: string
          bank_code?: string
          bank_name?: string
          city?: string | null
          created_at?: string
          finance_contact_name?: string
          finance_whatsapp?: string
          finance_document_display?: string | null
          asaas_environment_label?: string
          id?: string
          name: string
          slug: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank_account?: string
          bank_branch?: string
          bank_code?: string
          bank_name?: string
          city?: string | null
          created_at?: string
          finance_contact_name?: string
          finance_whatsapp?: string
          finance_document_display?: string | null
          asaas_environment_label?: string
          id?: string
          name?: string
          slug?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      academy_billing_settings: {
        Row: {
          academy_id: string
          boleto_due_day: number
          boleto_issue_day: number
          created_at: string
          id: string
          payment_provider: string
          send_whatsapp_automatically: boolean
          updated_at: string
          whatsapp_provider: string
        }
        Insert: {
          academy_id: string
          boleto_due_day?: number
          boleto_issue_day?: number
          created_at?: string
          id?: string
          payment_provider?: string
          send_whatsapp_automatically?: boolean
          updated_at?: string
          whatsapp_provider?: string
        }
        Update: {
          academy_id?: string
          boleto_due_day?: number
          boleto_issue_day?: number
          created_at?: string
          id?: string
          payment_provider?: string
          send_whatsapp_automatically?: boolean
          updated_at?: string
          whatsapp_provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_billing_settings_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: true
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          academy_id: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          professor_user_id: string
          started_at: string
          token: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          professor_user_id: string
          started_at?: string
          token: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          professor_user_id?: string
          started_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendances: {
        Row: {
          academy_id: string
          checked_in_at: string
          created_at: string
          id: string
          session_id: string
          student_id: string
        }
        Insert: {
          academy_id: string
          checked_in_at?: string
          created_at?: string
          id?: string
          session_id: string
          student_id: string
        }
        Update: {
          academy_id?: string
          checked_in_at?: string
          created_at?: string
          id?: string
          session_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendances_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "attendances_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      billings: {
        Row: {
          academy_id: string
          amount: number
          asaas_payment_id: string | null
          boleto_url: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string | null
          issue_date: string
          last_error: string | null
          paid_at: string | null
          plan_id: string | null
          reference_month: string
          status: Database["public"]["Enums"]["billing_status"]
          student_id: string
          updated_at: string
          whatsapp_sent_at: string | null
        }
        Insert: {
          academy_id: string
          amount: number
          asaas_payment_id?: string | null
          boleto_url?: string | null
          created_at?: string
          due_date: string
          id?: string
          invoice_number?: string | null
          issue_date: string
          last_error?: string | null
          paid_at?: string | null
          plan_id?: string | null
          reference_month: string
          status?: Database["public"]["Enums"]["billing_status"]
          student_id: string
          updated_at?: string
          whatsapp_sent_at?: string | null
        }
        Update: {
          academy_id?: string
          amount?: number
          asaas_payment_id?: string | null
          boleto_url?: string | null
          created_at?: string
          due_date?: string
          id?: string
          invoice_number?: string | null
          issue_date?: string
          last_error?: string | null
          paid_at?: string | null
          plan_id?: string | null
          reference_month?: string
          status?: Database["public"]["Enums"]["billing_status"]
          student_id?: string
          updated_at?: string
          whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billings_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billings_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "billings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          academy_id: string
          active: boolean
          created_at: string
          id: string
          monthly_price: number
          name: string
          training_days_per_week: number | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          active?: boolean
          created_at?: string
          id?: string
          monthly_price: number
          name: string
          training_days_per_week?: number | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          active?: boolean
          created_at?: string
          id?: string
          monthly_price?: number
          name?: string
          training_days_per_week?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          academy_id: string
          avatar_url: string | null
          created_at: string
          full_name: string
          updated_at: string
          user_id: string
          whatsapp: string | null
        }
        Insert: {
          academy_id: string
          avatar_url?: string | null
          created_at?: string
          full_name: string
          updated_at?: string
          user_id: string
          whatsapp?: string | null
        }
        Update: {
          academy_id?: string
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          academy_id: string
          asaas_customer_id: string | null
          belt: string | null
          birth_date: string | null
          created_at: string
          degrees: number
          email: string | null
          emergency_contact: string | null
          full_name: string
          id: string
          photo_url: string | null
          plan_id: string | null
          profile_user_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["student_status"]
          updated_at: string
          whatsapp: string
        }
        Insert: {
          academy_id: string
          asaas_customer_id?: string | null
          belt?: string | null
          birth_date?: string | null
          created_at?: string
          degrees?: number
          email?: string | null
          emergency_contact?: string | null
          full_name: string
          id?: string
          photo_url?: string | null
          plan_id?: string | null
          profile_user_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
          whatsapp: string
        }
        Update: {
          academy_id?: string
          asaas_customer_id?: string | null
          belt?: string | null
          birth_date?: string | null
          created_at?: string
          degrees?: number
          email?: string | null
          emergency_contact?: string | null
          full_name?: string
          id?: string
          photo_url?: string | null
          plan_id?: string | null
          profile_user_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      student_billing_profiles: {
        Row: {
          student_id: string
          tax_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          student_id: string
          tax_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          student_id?: string
          tax_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_billing_profiles_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_plan_change_requests: {
        Row: {
          id: string
          student_id: string
          current_plan_id: string | null
          requested_plan_id: string
          requested_by: string
          requested_by_role: string
          status: Database["public"]["Enums"]["plan_change_request_status"]
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          student_id: string
          current_plan_id?: string | null
          requested_plan_id: string
          requested_by: string
          requested_by_role: string
          status?: Database["public"]["Enums"]["plan_change_request_status"]
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          student_id?: string
          current_plan_id?: string | null
          requested_plan_id?: string
          requested_by?: string
          requested_by_role?: string
          status?: Database["public"]["Enums"]["plan_change_request_status"]
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_plan_change_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_plan_change_requests_current_plan_id_fkey"
            columns: ["current_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_plan_change_requests_requested_plan_id_fkey"
            columns: ["requested_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          id: string
          academy_id: string
          name: string
          schedule_days: string
          schedule_time: string
          plan_id: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          academy_id: string
          name: string
          schedule_days?: string
          schedule_time?: string
          plan_id?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          academy_id?: string
          name?: string
          schedule_days?: string
          schedule_time?: string
          plan_id?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          id: string
          academy_id: string | null
          student_id: string | null
          billing_id: string | null
          recipient: string
          message_type: string
          body: string
          status: string
          attempts: number
          max_attempts: number
          external_id: string | null
          error_message: string | null
          sent_at: string | null
          confirmed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          academy_id?: string | null
          student_id?: string | null
          billing_id?: string | null
          recipient: string
          message_type?: string
          body: string
          status?: string
          attempts?: number
          max_attempts?: number
          external_id?: string | null
          error_message?: string | null
          sent_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          academy_id?: string | null
          student_id?: string | null
          billing_id?: string | null
          recipient?: string
          message_type?: string
          body?: string
          status?: string
          attempts?: number
          max_attempts?: number
          external_id?: string | null
          error_message?: string | null
          sent_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      student_financial_overview: {
        Row: {
          academy_id: string | null
          amount: number | null
          billing_id: string | null
          boleto_url: string | null
          due_date: string | null
          full_name: string | null
          issue_date: string | null
          monthly_price: number | null
          paid_at: string | null
          plan_name: string | null
          reference_month: string | null
          status: Database["public"]["Enums"]["billing_status"] | null
          student_id: string | null
          whatsapp_sent_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_access_billing: { Args: { _billing_id: string }; Returns: boolean }
      can_access_student: { Args: { _student_id: string }; Returns: boolean }
      complete_student_signup: {
        Args: { _academy_id: string; _full_name: string; _whatsapp?: string }
        Returns: undefined
      }
      get_billing_cron_secret: { Args: never; Returns: string }
      get_my_academy_id: { Args: never; Returns: string }
      get_public_academies: {
        Args: never
        Returns: {
          id: string
          name: string
          slug: string
        }[]
      }
      get_public_active_plans: {
        Args: { _academy_id: string }
        Returns: {
          id: string
          name: string
          monthly_price: number
          training_days_per_week: number
        }[]
      }
      update_student_plan: {
        Args: { _student_id: string; _plan_id?: string | null }
        Returns: undefined
      }
      request_student_plan_change: {
        Args: { _student_id: string; _requested_plan_id: string }
        Returns: string
      }
      approve_student_plan_change: {
        Args: { _request_id: string }
        Returns: undefined
      }
      reject_student_plan_change: {
        Args: { _request_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      approve_student: {
        Args: { _student_id: string; _approve?: boolean }
        Returns: undefined
      }
      get_student_billing_tax_id_masked: {
        Args: { _student_id: string }
        Returns: { masked: string | null; has_tax_id: boolean }[]
      }
      list_student_billing_tax_id_masked: {
        Args: { _academy_id: string }
        Returns: { student_id: string; masked: string | null; has_tax_id: boolean }[]
      }
      upsert_student_billing_tax_id: {
        Args: { _student_id: string; _tax_id: string }
        Returns: undefined
      }
      manage_staff_member: {
        Args: {
          _whatsapp: string
          _full_name: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: string
      }
      record_attendance_by_token: {
        Args: { _token: string }
        Returns: Json
      }
      update_student_graduation: {
        Args: { _student_id: string; _belt: string; _degrees: number }
        Returns: undefined
      }
      is_admin_of_academy: { Args: { _academy_id: string }; Returns: boolean }
      is_admin_only: { Args: { _academy_id: string }; Returns: boolean }
      matches_billing_cron_secret: {
        Args: { _secret: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "aluno" | "professor"
      billing_status:
        | "pendente"
        | "gerado"
        | "enviado_whatsapp"
        | "pago"
        | "vencido"
        | "cancelado"
        | "falhou"
      student_status: "ativo" | "inativo" | "pendente_aprovacao" | "rejeitado"
      plan_change_request_status: "pending" | "approved" | "rejected"
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
      app_role: ["admin", "aluno", "professor"],
      billing_status: [
        "pendente",
        "gerado",
        "enviado_whatsapp",
        "pago",
        "vencido",
        "cancelado",
        "falhou",
      ],
      student_status: ["ativo", "inativo", "pendente_aprovacao", "rejeitado"],
      plan_change_request_status: ["pending", "approved", "rejected"],
    },
  },
} as const
