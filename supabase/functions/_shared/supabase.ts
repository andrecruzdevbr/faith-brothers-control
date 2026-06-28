import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEnv } from "./env.ts";

export function createServiceClient(): SupabaseClient {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createUserClient(authHeader: string): SupabaseClient {
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!key) throw new Error("SUPABASE_ANON_KEY is not configured");
  return createClient(getEnv("SUPABASE_URL"), key, {
    global: { headers: { Authorization: authHeader } },
  });
}

export async function requireAdmin(authHeader: string): Promise<{ userId: string; supabase: SupabaseClient }> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

  const supabase = createUserClient(authHeader);
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) throw new Error("Unauthorized");

  const userId = claimsData.claims.sub as string;
  const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (roleError || !isAdmin) throw new Error("Forbidden");

  return { userId, supabase };
}

export async function requireAuth(authHeader: string): Promise<{ userId: string; supabase: SupabaseClient }> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

  const supabase = createUserClient(authHeader);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");

  return { userId: user.id, supabase };
}

export async function requireStaff(authHeader: string): Promise<{ userId: string; supabase: SupabaseClient }> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

  const supabase = createUserClient(authHeader);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const isStaff = roles?.some((r) => r.role === "admin" || r.role === "professor");
  if (!isStaff) throw new Error("Forbidden");

  return { userId: user.id, supabase };
}
