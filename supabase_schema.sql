

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."mcp_server_status" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'SUGGESTED',
    'DECLINED'
);


ALTER TYPE "public"."mcp_server_status" OWNER TO "postgres";


CREATE TYPE "public"."mcp_server_type" AS ENUM (
    'STDIO',
    'SSE'
);


ALTER TYPE "public"."mcp_server_type" OWNER TO "postgres";


CREATE TYPE "public"."profile_capability" AS ENUM (
    'TOOLS_MANAGEMENT'
);


ALTER TYPE "public"."profile_capability" OWNER TO "postgres";


CREATE TYPE "public"."toggle_status" AS ENUM (
    'ACTIVE',
    'INACTIVE'
);


ALTER TYPE "public"."toggle_status" OWNER TO "postgres";


CREATE TYPE "public"."tool_execution_status" AS ENUM (
    'SUCCESS',
    'ERROR',
    'PENDING'
);


ALTER TYPE "public"."tool_execution_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_member"("project_id" "uuid", "user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users_projects up
    WHERE up.project_uuid = project_id
      AND up.user_uuid = user_id -- Corrected column name
  );
$$;


ALTER FUNCTION "public"."is_project_member"("project_id" "uuid", "user_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_uuid" "uuid" NOT NULL,
    "api_key" "text" NOT NULL,
    "name" "text" DEFAULT 'API Key'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."codes" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "file_name" "text" NOT NULL
);


ALTER TABLE "public"."codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_mcp_servers" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "additional_args" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "env" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile_uuid" "uuid" NOT NULL,
    "status" "public"."mcp_server_status" DEFAULT 'ACTIVE'::"public"."mcp_server_status" NOT NULL,
    "code_uuid" "uuid" NOT NULL
);


ALTER TABLE "public"."custom_mcp_servers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mcp_servers" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "command" "text",
    "args" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "env" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile_uuid" "uuid" NOT NULL,
    "status" "public"."mcp_server_status" DEFAULT 'ACTIVE'::"public"."mcp_server_status" NOT NULL,
    "type" "public"."mcp_server_type" DEFAULT 'STDIO'::"public"."mcp_server_type" NOT NULL,
    "url" "text"
);


ALTER TABLE "public"."mcp_servers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "project_uuid" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "enabled_capabilities" "public"."profile_capability"[] DEFAULT '{}'::"public"."profile_capability"[] NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "active_profile_uuid" "uuid"
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tool_execution_logs" (
    "id" integer NOT NULL,
    "mcp_server_uuid" "uuid",
    "tool_name" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result" "jsonb",
    "status" "public"."tool_execution_status" DEFAULT 'PENDING'::"public"."tool_execution_status" NOT NULL,
    "error_message" "text",
    "execution_time_ms" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tool_execution_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."tool_execution_logs" IS 'Stores logs for executed tools.';



CREATE SEQUENCE IF NOT EXISTS "public"."tool_execution_logs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."tool_execution_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tool_execution_logs_id_seq" OWNED BY "public"."tool_execution_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."tools" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "tool_schema" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mcp_server_uuid" "uuid" NOT NULL,
    "status" "public"."toggle_status" DEFAULT 'ACTIVE'::"public"."toggle_status" NOT NULL
);


ALTER TABLE "public"."tools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users_projects" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_uuid" "uuid" NOT NULL,
    "project_uuid" "uuid" NOT NULL
);


ALTER TABLE "public"."users_projects" OWNER TO "postgres";


COMMENT ON TABLE "public"."users_projects" IS 'Junction table establishing a many-to-many relationship between users and projects.';



COMMENT ON COLUMN "public"."users_projects"."uuid" IS 'Primary key for the user-project link.';



COMMENT ON COLUMN "public"."users_projects"."user_uuid" IS 'Foreign key referencing the user ID from auth.users.';



COMMENT ON COLUMN "public"."users_projects"."project_uuid" IS 'Foreign key referencing the project ID from public.projects.';



ALTER TABLE ONLY "public"."tool_execution_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tool_execution_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."codes"
    ADD CONSTRAINT "codes_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."custom_mcp_servers"
    ADD CONSTRAINT "custom_mcp_servers_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."mcp_servers"
    ADD CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."tool_execution_logs"
    ADD CONSTRAINT "tool_execution_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_unique_tool_name_per_server_idx" UNIQUE ("mcp_server_uuid", "name");



ALTER TABLE ONLY "public"."users_projects"
    ADD CONSTRAINT "users_projects_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."users_projects"
    ADD CONSTRAINT "users_projects_user_project_unique" UNIQUE ("user_uuid", "project_uuid");



CREATE INDEX "api_keys_project_uuid_idx" ON "public"."api_keys" USING "btree" ("project_uuid");



CREATE INDEX "custom_mcp_servers_profile_uuid_idx" ON "public"."custom_mcp_servers" USING "btree" ("profile_uuid");



CREATE INDEX "custom_mcp_servers_status_idx" ON "public"."custom_mcp_servers" USING "btree" ("status");



CREATE INDEX "idx_users_projects_project_uuid" ON "public"."users_projects" USING "btree" ("project_uuid");



CREATE INDEX "idx_users_projects_user_uuid" ON "public"."users_projects" USING "btree" ("user_uuid");



CREATE INDEX "mcp_servers_profile_uuid_idx" ON "public"."mcp_servers" USING "btree" ("profile_uuid");



CREATE INDEX "mcp_servers_status_idx" ON "public"."mcp_servers" USING "btree" ("status");



CREATE INDEX "mcp_servers_type_idx" ON "public"."mcp_servers" USING "btree" ("type");



CREATE INDEX "profiles_project_uuid_idx" ON "public"."profiles" USING "btree" ("project_uuid");



CREATE INDEX "tool_execution_logs_created_at_idx" ON "public"."tool_execution_logs" USING "btree" ("created_at");



CREATE INDEX "tool_execution_logs_mcp_server_uuid_idx" ON "public"."tool_execution_logs" USING "btree" ("mcp_server_uuid");



CREATE INDEX "tool_execution_logs_tool_name_idx" ON "public"."tool_execution_logs" USING "btree" ("tool_name");



CREATE INDEX "tools_mcp_server_uuid_idx" ON "public"."tools" USING "btree" ("mcp_server_uuid");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_project_uuid_projects_uuid_fk" FOREIGN KEY ("project_uuid") REFERENCES "public"."projects"("uuid");



ALTER TABLE ONLY "public"."custom_mcp_servers"
    ADD CONSTRAINT "custom_mcp_servers_code_uuid_codes_uuid_fk" FOREIGN KEY ("code_uuid") REFERENCES "public"."codes"("uuid");



ALTER TABLE ONLY "public"."custom_mcp_servers"
    ADD CONSTRAINT "custom_mcp_servers_profile_uuid_profiles_uuid_fk" FOREIGN KEY ("profile_uuid") REFERENCES "public"."profiles"("uuid");



ALTER TABLE ONLY "public"."mcp_servers"
    ADD CONSTRAINT "mcp_servers_profile_uuid_profiles_uuid_fk" FOREIGN KEY ("profile_uuid") REFERENCES "public"."profiles"("uuid");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_project_uuid_fkey" FOREIGN KEY ("project_uuid") REFERENCES "public"."projects"("uuid") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_active_profile_uuid_fkey" FOREIGN KEY ("active_profile_uuid") REFERENCES "public"."profiles"("uuid") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tool_execution_logs"
    ADD CONSTRAINT "tool_execution_logs_mcp_server_uuid_fkey" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid");



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users_projects"
    ADD CONSTRAINT "users_projects_project_uuid_fkey" FOREIGN KEY ("project_uuid") REFERENCES "public"."projects"("uuid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users_projects"
    ADD CONSTRAINT "users_projects_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Allow authenticated users to insert codes" ON "public"."codes" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow user CRUD access based on project membership" ON "public"."api_keys" USING ("public"."is_project_member"("project_uuid", "auth"."uid"())) WITH CHECK ("public"."is_project_member"("project_uuid", "auth"."uid"()));



CREATE POLICY "Allow user CRUD access based on project membership" ON "public"."profiles" USING ("public"."is_project_member"("project_uuid", "auth"."uid"())) WITH CHECK ("public"."is_project_member"("project_uuid", "auth"."uid"()));



CREATE POLICY "Allow user CRUD access based on project membership via mcp_serv" ON "public"."tool_execution_logs" USING ((("mcp_server_uuid" IS NULL) OR (EXISTS ( SELECT 1
   FROM ("public"."mcp_servers" "ms"
     JOIN "public"."profiles" "p" ON (("ms"."profile_uuid" = "p"."uuid")))
  WHERE (("ms"."uuid" = "tool_execution_logs"."mcp_server_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"())))))) WITH CHECK ((("mcp_server_uuid" IS NULL) OR (EXISTS ( SELECT 1
   FROM ("public"."mcp_servers" "ms"
     JOIN "public"."profiles" "p" ON (("ms"."profile_uuid" = "p"."uuid")))
  WHERE (("ms"."uuid" = "tool_execution_logs"."mcp_server_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"()))))));



CREATE POLICY "Allow user CRUD access based on project membership via mcp_serv" ON "public"."tools" USING ((EXISTS ( SELECT 1
   FROM ("public"."mcp_servers" "ms"
     JOIN "public"."profiles" "p" ON (("ms"."profile_uuid" = "p"."uuid")))
  WHERE (("ms"."uuid" = "tools"."mcp_server_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."mcp_servers" "ms"
     JOIN "public"."profiles" "p" ON (("ms"."profile_uuid" = "p"."uuid")))
  WHERE (("ms"."uuid" = "tools"."mcp_server_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"())))));



CREATE POLICY "Allow user CRUD access based on project membership via profile" ON "public"."custom_mcp_servers" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."uuid" = "custom_mcp_servers"."profile_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."uuid" = "custom_mcp_servers"."profile_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"())))));



CREATE POLICY "Allow user CRUD access based on project membership via profile" ON "public"."mcp_servers" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."uuid" = "mcp_servers"."profile_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."uuid" = "mcp_servers"."profile_uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"())))));



CREATE POLICY "Allow user CRUD access based on users_projects" ON "public"."projects" USING ("public"."is_project_member"("uuid", "auth"."uid"())) WITH CHECK ("public"."is_project_member"("uuid", "auth"."uid"()));



CREATE POLICY "Allow user delete if used by accessible custom server" ON "public"."codes" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."custom_mcp_servers" "cms"
     JOIN "public"."profiles" "p" ON (("cms"."profile_uuid" = "p"."uuid")))
  WHERE (("cms"."code_uuid" = "codes"."uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"())))));



CREATE POLICY "Allow user full access to their own membership records" ON "public"."users_projects" USING (("auth"."uid"() = "user_uuid")) WITH CHECK (("auth"."uid"() = "user_uuid"));



CREATE POLICY "Allow user read access if used by accessible custom server" ON "public"."codes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."custom_mcp_servers" "cms"
     JOIN "public"."profiles" "p" ON (("cms"."profile_uuid" = "p"."uuid")))
  WHERE (("cms"."code_uuid" = "codes"."uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"())))));



CREATE POLICY "Allow user update if used by accessible custom server" ON "public"."codes" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."custom_mcp_servers" "cms"
     JOIN "public"."profiles" "p" ON (("cms"."profile_uuid" = "p"."uuid")))
  WHERE (("cms"."code_uuid" = "codes"."uuid") AND "public"."is_project_member"("p"."project_uuid", "auth"."uid"())))));



ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_mcp_servers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_servers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tool_execution_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users_projects" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_member"("project_id" "uuid", "user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_member"("project_id" "uuid", "user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("project_id" "uuid", "user_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."codes" TO "anon";
GRANT ALL ON TABLE "public"."codes" TO "authenticated";
GRANT ALL ON TABLE "public"."codes" TO "service_role";



GRANT ALL ON TABLE "public"."custom_mcp_servers" TO "anon";
GRANT ALL ON TABLE "public"."custom_mcp_servers" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_mcp_servers" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_servers" TO "anon";
GRANT ALL ON TABLE "public"."mcp_servers" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_servers" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."tool_execution_logs" TO "anon";
GRANT ALL ON TABLE "public"."tool_execution_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."tool_execution_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tool_execution_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tool_execution_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tool_execution_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tools" TO "anon";
GRANT ALL ON TABLE "public"."tools" TO "authenticated";
GRANT ALL ON TABLE "public"."tools" TO "service_role";



GRANT ALL ON TABLE "public"."users_projects" TO "anon";
GRANT ALL ON TABLE "public"."users_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."users_projects" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






RESET ALL;
