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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academies: {
        Row: {
          address: string | null
          asaas_environment_label: string
          bank_account: string
          bank_branch: string
          bank_code: string
          bank_name: string
          city: string | null
          created_at: string
          finance_contact_name: string
          finance_document_display: string | null
          finance_whatsapp: string
          id: string
          name: string
          slug: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          asaas_environment_label?: string
          bank_account?: string
          bank_branch?: string
          bank_code?: string
          bank_name?: string
          city?: string | null
          created_at?: string
          finance_contact_name?: string
          finance_document_display?: string | null
          finance_whatsapp?: string
          id?: string
          name: string
          slug: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          asaas_environment_label?: string
          bank_account?: string
          bank_branch?: string
          bank_code?: string
          bank_name?: string
          city?: string | null
          created_at?: string
          finance_contact_name?: string
          finance_document_display?: string | null
          finance_whatsapp?: string
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
          family_plans_enabled: boolean
          id: string
          payment_provider: string
          prepaid_contracts_enabled: boolean
          send_whatsapp_automatically: boolean
          updated_at: string
          whatsapp_provider: string
        }
        Insert: {
          academy_id: string
          boleto_due_day?: number
          boleto_issue_day?: number
          created_at?: string
          family_plans_enabled?: boolean
          id?: string
          payment_provider?: string
          prepaid_contracts_enabled?: boolean
          send_whatsapp_automatically?: boolean
          updated_at?: string
          whatsapp_provider?: string
        }
        Update: {
          academy_id?: string
          boleto_due_day?: number
          boleto_issue_day?: number
          created_at?: string
          family_plans_enabled?: boolean
          id?: string
          payment_provider?: string
          prepaid_contracts_enabled?: boolean
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
            foreignKeyName: "attendances_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions_public"
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
      birthday_messages: {
        Row: {
          academy_id: string
          birthday_year: number
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          sent_at: string | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          academy_id: string
          birthday_year: number
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          sent_at?: string | null
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          academy_id?: string
          birthday_year?: number
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "birthday_messages_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "birthday_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "birthday_messages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "birthday_messages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          academy_id: string
          active: boolean
          created_at: string
          id: string
          name: string
          plan_id: string | null
          schedule_days: string
          schedule_time: string
          updated_at: string
        }
        Insert: {
          academy_id: string
          active?: boolean
          created_at?: string
          id?: string
          name: string
          plan_id?: string | null
          schedule_days?: string
          schedule_time?: string
          updated_at?: string
        }
        Update: {
          academy_id?: string
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          plan_id?: string | null
          schedule_days?: string
          schedule_time?: string
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
          {
            foreignKeyName: "classes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_members: {
        Row: {
          contract_id: string
          coverage_ends_on: string
          coverage_starts_on: string
          created_at: string
          id: string
          plan_id: string | null
          status: string
          student_id: string
          updated_at: string
          weekly_frequency: number | null
        }
        Insert: {
          contract_id: string
          coverage_ends_on: string
          coverage_starts_on: string
          created_at?: string
          id?: string
          plan_id?: string | null
          status?: string
          student_id: string
          updated_at?: string
          weekly_frequency?: number | null
        }
        Update: {
          contract_id?: string
          coverage_ends_on?: string
          coverage_starts_on?: string
          created_at?: string
          id?: string
          plan_id?: string | null
          status?: string
          student_id?: string
          updated_at?: string
          weekly_frequency?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_members_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "student_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_members_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "contract_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_payments: {
        Row: {
          action: string
          amount: number
          confirmation_meta: Json
          confirmed_at: string
          confirmed_by: string | null
          contract_id: string
          created_at: string
          id: string
          installments: number
          machine_reference: string | null
          notes: string | null
          payment_method: string
        }
        Insert: {
          action: string
          amount: number
          confirmation_meta?: Json
          confirmed_at?: string
          confirmed_by?: string | null
          contract_id: string
          created_at?: string
          id?: string
          installments?: number
          machine_reference?: string | null
          notes?: string | null
          payment_method: string
        }
        Update: {
          action?: string
          amount?: number
          confirmation_meta?: Json
          confirmed_at?: string
          confirmed_by?: string | null
          contract_id?: string
          created_at?: string
          id?: string
          installments?: number
          machine_reference?: string | null
          notes?: string | null
          payment_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "student_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      family_groups: {
        Row: {
          academy_id: string
          created_at: string
          estimated_member_count: number | null
          financial_responsible_email: string | null
          financial_responsible_name: string
          financial_responsible_phone: string | null
          financial_responsible_student_id: string | null
          financial_responsible_tax_id: string | null
          id: string
          invite_code: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          academy_id: string
          created_at?: string
          estimated_member_count?: number | null
          financial_responsible_email?: string | null
          financial_responsible_name: string
          financial_responsible_phone?: string | null
          financial_responsible_student_id?: string | null
          financial_responsible_tax_id?: string | null
          id?: string
          invite_code: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          academy_id?: string
          created_at?: string
          estimated_member_count?: number | null
          financial_responsible_email?: string | null
          financial_responsible_name?: string
          financial_responsible_phone?: string | null
          financial_responsible_student_id?: string | null
          financial_responsible_tax_id?: string | null
          id?: string
          invite_code?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_groups_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_groups_financial_responsible_student_id_fkey"
            columns: ["financial_responsible_student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "family_groups_financial_responsible_student_id_fkey"
            columns: ["financial_responsible_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          created_at: string
          family_group_id: string
          id: string
          joined_at: string | null
          left_at: string | null
          relationship: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_group_id: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          relationship?: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_group_id?: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          relationship?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_group_id_fkey"
            columns: ["family_group_id"]
            isOneToOne: false
            referencedRelation: "family_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "family_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_rate_limits: {
        Row: {
          blocked_until: string | null
          request_count: number
          whatsapp: string
          window_start: string
        }
        Insert: {
          blocked_until?: string | null
          request_count?: number
          whatsapp: string
          window_start?: string
        }
        Update: {
          blocked_until?: string | null
          request_count?: number
          whatsapp?: string
          window_start?: string
        }
        Relationships: []
      }
      otp_tokens: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          used: boolean
          whatsapp: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          used?: boolean
          whatsapp: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          used?: boolean
          whatsapp?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          academy_id: string
          active: boolean
          allows_installments: boolean
          audience: string
          billing_mode: string
          category: string | null
          created_at: string
          description: string | null
          duration_months: number
          id: string
          max_installments: number
          monthly_price: number
          name: string
          package_total_amount: number | null
          plan_kind: string
          reference_monthly_price: number | null
          training_days_per_week: number | null
          updated_at: string
        }
        Insert: {
          academy_id: string
          active?: boolean
          allows_installments?: boolean
          audience?: string
          billing_mode?: string
          category?: string | null
          created_at?: string
          description?: string | null
          duration_months?: number
          id?: string
          max_installments?: number
          monthly_price: number
          name: string
          package_total_amount?: number | null
          plan_kind?: string
          reference_monthly_price?: number | null
          training_days_per_week?: number | null
          updated_at?: string
        }
        Update: {
          academy_id?: string
          active?: boolean
          allows_installments?: boolean
          audience?: string
          billing_mode?: string
          category?: string | null
          created_at?: string
          description?: string | null
          duration_months?: number
          id?: string
          max_installments?: number
          monthly_price?: number
          name?: string
          package_total_amount?: number | null
          plan_kind?: string
          reference_monthly_price?: number | null
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
      student_billing_profiles: {
        Row: {
          created_at: string
          student_id: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          student_id: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          student_id?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_billing_profiles_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "student_billing_profiles_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_contract_months: {
        Row: {
          academy_id: string
          contract_id: string
          created_at: string
          id: string
          paid_at: string | null
          reference_month: string
          source: string
          status: string
          student_id: string
        }
        Insert: {
          academy_id: string
          contract_id: string
          created_at?: string
          id?: string
          paid_at?: string | null
          reference_month: string
          source?: string
          status?: string
          student_id: string
        }
        Update: {
          academy_id?: string
          contract_id?: string
          created_at?: string
          id?: string
          paid_at?: string | null
          reference_month?: string
          source?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_contract_months_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_contract_months_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "student_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_contract_months_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "student_contract_months_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_contracts: {
        Row: {
          academy_id: string
          approved_at: string | null
          approved_by: string | null
          confirmation_meta: Json
          contract_status: string
          created_at: string
          duration_months: number
          ends_on: string
          family_group_id: string | null
          id: string
          installments: number
          payment_confirmed_at: string | null
          payment_confirmed_by: string | null
          payment_method: string
          payment_status: string
          plan_id: string
          reference_monthly_amount: number | null
          registration_notes: string | null
          starts_on: string
          student_id: string | null
          total_amount: number
          updated_at: string
          weekly_frequency: number | null
        }
        Insert: {
          academy_id: string
          approved_at?: string | null
          approved_by?: string | null
          confirmation_meta?: Json
          contract_status?: string
          created_at?: string
          duration_months: number
          ends_on: string
          family_group_id?: string | null
          id?: string
          installments?: number
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          payment_method: string
          payment_status?: string
          plan_id: string
          reference_monthly_amount?: number | null
          registration_notes?: string | null
          starts_on: string
          student_id?: string | null
          total_amount: number
          updated_at?: string
          weekly_frequency?: number | null
        }
        Update: {
          academy_id?: string
          approved_at?: string | null
          approved_by?: string | null
          confirmation_meta?: Json
          contract_status?: string
          created_at?: string
          duration_months?: number
          ends_on?: string
          family_group_id?: string | null
          id?: string
          installments?: number
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          payment_method?: string
          payment_status?: string
          plan_id?: string
          reference_monthly_amount?: number | null
          registration_notes?: string | null
          starts_on?: string
          student_id?: string | null
          total_amount?: number
          updated_at?: string
          weekly_frequency?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_contracts_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_contracts_family_group_id_fkey"
            columns: ["family_group_id"]
            isOneToOne: false
            referencedRelation: "family_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_contracts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_contracts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "student_contracts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_plan_change_requests: {
        Row: {
          created_at: string
          current_plan_id: string | null
          id: string
          requested_by: string
          requested_by_role: string
          requested_plan_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["plan_change_request_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_plan_id?: string | null
          id?: string
          requested_by: string
          requested_by_role: string
          requested_plan_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["plan_change_request_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_plan_id?: string | null
          id?: string
          requested_by?: string
          requested_by_role?: string
          requested_plan_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["plan_change_request_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
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
          {
            foreignKeyName: "student_plan_change_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "student_plan_change_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          guardian_name: string | null
          id: string
          payment_review_status: string
          pending_family_group_id: string | null
          pending_family_invite_code: string | null
          photo_url: string | null
          plan_id: string | null
          profile_user_id: string | null
          requested_installments: number | null
          requested_payment_method: string | null
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
          guardian_name?: string | null
          id?: string
          payment_review_status?: string
          pending_family_group_id?: string | null
          pending_family_invite_code?: string | null
          photo_url?: string | null
          plan_id?: string | null
          profile_user_id?: string | null
          requested_installments?: number | null
          requested_payment_method?: string | null
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
          guardian_name?: string | null
          id?: string
          payment_review_status?: string
          pending_family_group_id?: string | null
          pending_family_invite_code?: string | null
          photo_url?: string | null
          plan_id?: string | null
          profile_user_id?: string | null
          requested_installments?: number | null
          requested_payment_method?: string | null
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
            foreignKeyName: "students_pending_family_group_id_fkey"
            columns: ["pending_family_group_id"]
            isOneToOne: false
            referencedRelation: "family_groups"
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
      whatsapp_messages: {
        Row: {
          academy_id: string | null
          attempts: number
          billing_id: string | null
          body: string
          confirmed_at: string | null
          created_at: string
          error_message: string | null
          external_id: string | null
          id: string
          max_attempts: number
          message_type: string
          recipient: string
          sent_at: string | null
          status: string
          student_id: string | null
          updated_at: string
        }
        Insert: {
          academy_id?: string | null
          attempts?: number
          billing_id?: string | null
          body: string
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          max_attempts?: number
          message_type?: string
          recipient: string
          sent_at?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Update: {
          academy_id?: string | null
          attempts?: number
          billing_id?: string | null
          body?: string
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          max_attempts?: number
          message_type?: string
          recipient?: string
          sent_at?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_academy_id_fkey"
            columns: ["academy_id"]
            isOneToOne: false
            referencedRelation: "academies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_billing_id_fkey"
            columns: ["billing_id"]
            isOneToOne: false
            referencedRelation: "billings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_billing_id_fkey"
            columns: ["billing_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["billing_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_financial_overview"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      attendance_sessions_public: {
        Row: {
          academy_id: string | null
          created_at: string | null
          ended_at: string | null
          expires_at: string | null
          id: string | null
          professor_user_id: string | null
          started_at: string | null
        }
        Insert: {
          academy_id?: string | null
          created_at?: string | null
          ended_at?: string | null
          expires_at?: string | null
          id?: string | null
          professor_user_id?: string | null
          started_at?: string | null
        }
        Update: {
          academy_id?: string | null
          created_at?: string | null
          ended_at?: string | null
          expires_at?: string | null
          id?: string | null
          professor_user_id?: string | null
          started_at?: string | null
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
      approve_student: {
        Args: { _approve?: boolean; _student_id: string }
        Returns: undefined
      }
      approve_student_plan_change: {
        Args: { _request_id: string }
        Returns: undefined
      }
      can_access_billing: { Args: { _billing_id: string }; Returns: boolean }
      can_access_student: { Args: { _student_id: string }; Returns: boolean }
      can_operate_ops: { Args: { _academy_id: string }; Returns: boolean }
      cancel_or_refund_prepaid_contract: {
        Args: {
          _action: string
          _confirmation_meta?: Json
          _contract_id: string
          _reason: string
        }
        Returns: string
      }
      cleanup_expired_otps: { Args: never; Returns: undefined }
      complete_student_registration_atomic: {
        Args: {
          _academy_id: string
          _belt?: string
          _birth_date?: string
          _contract_type?: string
          _estimated_member_count?: number
          _family_invite_code?: string
          _family_mode?: string
          _family_name?: string
          _family_relationship?: string
          _financial_responsible_email?: string
          _financial_responsible_name?: string
          _financial_responsible_phone?: string
          _full_name: string
          _guardian_name?: string
          _installments?: number
          _payment_method?: string
          _plan_id?: string
          _tax_id?: string
          _user_id: string
          _whatsapp: string
        }
        Returns: string
      }
      complete_student_signup: {
        Args: { _academy_id: string; _full_name: string; _whatsapp?: string }
        Returns: undefined
      }
      confirm_family_prepaid_payment: {
        Args: {
          _confirmation_meta?: Json
          _family_group_id: string
          _installments: number
          _machine_reference?: string
          _member_student_ids: string[]
          _notes?: string
          _payment_method: string
          _plan_id: string
          _starts_on: string
          _total_amount?: number
        }
        Returns: string
      }
      confirm_individual_prepaid_payment: {
        Args: {
          _confirmation_meta?: Json
          _installments: number
          _machine_reference?: string
          _notes?: string
          _payment_method: string
          _plan_id: string
          _starts_on: string
          _student_id: string
          _total_amount?: number
        }
        Returns: string
      }
      expire_ended_prepaid_contracts: {
        Args: { _as_of?: string }
        Returns: number
      }
      generate_family_invite_code: { Args: never; Returns: string }
      get_billing_cron_secret: { Args: never; Returns: string }
      get_my_academy_basic_info: {
        Args: never
        Returns: {
          address: string
          city: string
          id: string
          name: string
          slug: string
          state: string
        }[]
      }
      get_my_academy_id: { Args: never; Returns: string }
      get_public_academies: {
        Args: never
        Returns: {
          family_plans_enabled: boolean
          id: string
          name: string
          prepaid_contracts_enabled: boolean
          slug: string
        }[]
      }
      get_public_active_plans: {
        Args: { _academy_id: string }
        Returns: {
          allows_installments: boolean
          audience: string
          billing_mode: string
          description: string
          duration_months: number
          id: string
          max_installments: number
          monthly_price: number
          name: string
          package_total_amount: number
          plan_kind: string
          reference_monthly_price: number
          training_days_per_week: number
        }[]
      }
      get_student_billing_tax_id_masked: {
        Args: { _student_id: string }
        Returns: {
          has_tax_id: boolean
          masked: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_academy_limited_of: { Args: { _academy_id: string }; Returns: boolean }
      is_admin_of_academy: { Args: { _academy_id: string }; Returns: boolean }
      is_admin_only: { Args: { _academy_id: string }; Returns: boolean }
      is_staff_of_academy: { Args: { _academy_id: string }; Returns: boolean }
      is_valid_cnpj: { Args: { _cnpj: string }; Returns: boolean }
      is_valid_cpf: { Args: { _cpf: string }; Returns: boolean }
      is_valid_tax_id: { Args: { _tax_id: string }; Returns: boolean }
      list_student_billing_tax_id_masked: {
        Args: { _academy_id: string }
        Returns: {
          has_tax_id: boolean
          masked: string
          student_id: string
        }[]
      }
      manage_staff_member: {
        Args: {
          _full_name: string
          _roles: Database["public"]["Enums"]["app_role"][]
          _whatsapp: string
        }
        Returns: string
      }
      mask_tax_id: { Args: { _tax_id: string }; Returns: string }
      matches_billing_cron_secret: {
        Args: { _secret: string }
        Returns: boolean
      }
      normalize_tax_id: { Args: { _raw: string }; Returns: string }
      prepaid_coverage_months: {
        Args: { _duration_months: number; _starts_on: string }
        Returns: string[]
      }
      prepaid_cron_skip_reason: {
        Args: { _reference_month: string; _student_id: string }
        Returns: string
      }
      prepaid_ends_on: {
        Args: { _duration_months: number; _starts_on: string }
        Returns: string
      }
      prepaid_first_reference_month: {
        Args: { _starts_on: string }
        Returns: string
      }
      record_attendance_by_token: { Args: { _token: string }; Returns: Json }
      reject_student: { Args: { _student_id: string }; Returns: undefined }
      reject_student_plan_change: {
        Args: { _request_id: string }
        Returns: undefined
      }
      request_student_plan_change: {
        Args: { _requested_plan_id: string; _student_id: string }
        Returns: string
      }
      student_has_prepaid_month_coverage: {
        Args: { _reference_month: string; _student_id: string }
        Returns: boolean
      }
      tax_id_all_same_digits: { Args: { _digits: string }; Returns: boolean }
      update_student_plan: {
        Args: { _plan_id?: string; _student_id: string }
        Returns: undefined
      }
      upsert_student_billing_tax_id: {
        Args: { _student_id: string; _tax_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "aluno" | "professor" | "academy_limited"
      billing_status:
        | "pendente"
        | "gerado"
        | "enviado_whatsapp"
        | "pago"
        | "vencido"
        | "cancelado"
        | "falhou"
      plan_change_request_status: "pending" | "approved" | "rejected"
      student_status: "ativo" | "inativo" | "pendente_aprovacao" | "rejeitado"
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
      app_role: ["admin", "aluno", "professor", "academy_limited"],
      billing_status: [
        "pendente",
        "gerado",
        "enviado_whatsapp",
        "pago",
        "vencido",
        "cancelado",
        "falhou",
      ],
      plan_change_request_status: ["pending", "approved", "rejected"],
      student_status: ["ativo", "inativo", "pendente_aprovacao", "rejeitado"],
    },
  },
} as const
