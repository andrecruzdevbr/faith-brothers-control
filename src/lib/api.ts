import { supabase } from "@/integrations/supabase/client";

const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const baseUrl = import.meta.env.VITE_SUPABASE_URL ?? `https://${projectId}.supabase.co`;

export async function callEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  options?: { requireAuth?: boolean },
): Promise<T> {
  const publishableKey = (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  ) as string | undefined;

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (options?.requireAuth !== false) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Não autenticado");
    headers.Authorization = `Bearer ${session.access_token}`;
    if (publishableKey) headers.apikey = publishableKey;
  } else if (publishableKey) {
    headers.apikey = publishableKey;
    headers.Authorization = `Bearer ${publishableKey}`;
  }

  const res = await fetch(`${baseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? "Erro na requisição");
  return data as T;
}

export function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateBR(date: string) {
  return new Date(date + (date.includes("T") ? "" : "T12:00:00")).toLocaleDateString("pt-BR");
}
