/** Ambient types for Supabase Edge modules imported by the app test suite. */
declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
};

declare module "https://esm.sh/@supabase/supabase-js@2.57.4" {
  import type { SupabaseClient as Client, SupabaseClientOptions } from "@supabase/supabase-js";
  export type SupabaseClient = Client;
  export function createClient<Database = unknown>(
    url: string,
    key: string,
    options?: SupabaseClientOptions<keyof Database extends string ? keyof Database : never>,
  ): SupabaseClient;
}
