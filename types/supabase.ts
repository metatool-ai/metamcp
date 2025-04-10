export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      api_keys: {
        Row: {
          api_key: string
          created_at: string
          name: string | null
          project_uuid: string
          uuid: string
        }
        Insert: {
          api_key: string
          created_at?: string
          name?: string | null
          project_uuid: string
          uuid?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          name?: string | null
          project_uuid?: string
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_project_uuid_projects_uuid_fk"
            columns: ["project_uuid"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["uuid"]
          },
        ]
      }
      codes: {
        Row: {
          code: string
          created_at: string
          file_name: string
          uuid: string
        }
        Insert: {
          code: string
          created_at?: string
          file_name: string
          uuid?: string
        }
        Update: {
          code?: string
          created_at?: string
          file_name?: string
          uuid?: string
        }
        Relationships: []
      }
      custom_mcp_servers: {
        Row: {
          additional_args: string[]
          code_uuid: string
          created_at: string
          description: string | null
          env: Json
          name: string
          profile_uuid: string
          status: Database["public"]["Enums"]["mcp_server_status"]
          uuid: string
        }
        Insert: {
          additional_args?: string[]
          code_uuid: string
          created_at?: string
          description?: string | null
          env?: Json
          name: string
          profile_uuid: string
          status?: Database["public"]["Enums"]["mcp_server_status"]
          uuid?: string
        }
        Update: {
          additional_args?: string[]
          code_uuid?: string
          created_at?: string
          description?: string | null
          env?: Json
          name?: string
          profile_uuid?: string
          status?: Database["public"]["Enums"]["mcp_server_status"]
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_mcp_servers_code_uuid_codes_uuid_fk"
            columns: ["code_uuid"]
            isOneToOne: false
            referencedRelation: "codes"
            referencedColumns: ["uuid"]
          },
          {
            foreignKeyName: "custom_mcp_servers_profile_uuid_profiles_uuid_fk"
            columns: ["profile_uuid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["uuid"]
          },
        ]
      }
      mcp_servers: {
        Row: {
          args: string[]
          command: string | null
          created_at: string
          description: string | null
          env: Json
          name: string
          profile_uuid: string
          status: Database["public"]["Enums"]["mcp_server_status"]
          type: Database["public"]["Enums"]["mcp_server_type"]
          url: string | null
          uuid: string
        }
        Insert: {
          args?: string[]
          command?: string | null
          created_at?: string
          description?: string | null
          env?: Json
          name: string
          profile_uuid: string
          status?: Database["public"]["Enums"]["mcp_server_status"]
          type?: Database["public"]["Enums"]["mcp_server_type"]
          url?: string | null
          uuid?: string
        }
        Update: {
          args?: string[]
          command?: string | null
          created_at?: string
          description?: string | null
          env?: Json
          name?: string
          profile_uuid?: string
          status?: Database["public"]["Enums"]["mcp_server_status"]
          type?: Database["public"]["Enums"]["mcp_server_type"]
          url?: string | null
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_servers_profile_uuid_profiles_uuid_fk"
            columns: ["profile_uuid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["uuid"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          enabled_capabilities: Database["public"]["Enums"]["profile_capability"][]
          name: string
          project_uuid: string
          uuid: string
        }
        Insert: {
          created_at?: string
          enabled_capabilities?: Database["public"]["Enums"]["profile_capability"][]
          name: string
          project_uuid: string
          uuid?: string
        }
        Update: {
          created_at?: string
          enabled_capabilities?: Database["public"]["Enums"]["profile_capability"][]
          name?: string
          project_uuid?: string
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_project_uuid_fkey"
            columns: ["project_uuid"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["uuid"]
          },
        ]
      }
      projects: {
        Row: {
          active_profile_uuid: string | null
          created_at: string
          name: string
          uuid: string
        }
        Insert: {
          active_profile_uuid?: string | null
          created_at?: string
          name: string
          uuid?: string
        }
        Update: {
          active_profile_uuid?: string | null
          created_at?: string
          name?: string
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_active_profile_uuid_fkey"
            columns: ["active_profile_uuid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["uuid"]
          },
        ]
      }
      tools: {
        Row: {
          created_at: string
          description: string | null
          mcp_server_uuid: string
          name: string
          status: Database["public"]["Enums"]["toggle_status"]
          tool_schema: Json
          uuid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          mcp_server_uuid: string
          name: string
          status?: Database["public"]["Enums"]["toggle_status"]
          tool_schema: Json
          uuid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          mcp_server_uuid?: string
          name?: string
          status?: Database["public"]["Enums"]["toggle_status"]
          tool_schema?: Json
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "tools_mcp_server_uuid_mcp_servers_uuid_fk"
            columns: ["mcp_server_uuid"]
            isOneToOne: false
            referencedRelation: "mcp_servers"
            referencedColumns: ["uuid"]
          },
        ]
      }
      users_projects: {
        Row: {
          project_uuid: string
          user_uuid: string
          uuid: string
        }
        Insert: {
          project_uuid: string
          user_uuid: string
          uuid?: string
        }
        Update: {
          project_uuid?: string
          user_uuid?: string
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_projects_project_uuid_fkey"
            columns: ["project_uuid"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["uuid"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      mcp_server_status: "ACTIVE" | "INACTIVE" | "SUGGESTED" | "DECLINED"
      mcp_server_type: "STDIO" | "SSE"
      profile_capability: "TOOLS_MANAGEMENT"
      toggle_status: "ACTIVE" | "INACTIVE"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      mcp_server_status: ["ACTIVE", "INACTIVE", "SUGGESTED", "DECLINED"],
      mcp_server_type: ["STDIO", "SSE"],
      profile_capability: ["TOOLS_MANAGEMENT"],
      toggle_status: ["ACTIVE", "INACTIVE"],
    },
  },
} as const
