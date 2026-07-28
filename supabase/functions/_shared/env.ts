import { parseEnvBoolean } from "./evolution-config.ts";

export { parseEnvBoolean };

export function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getEnvOptional(name: string): string | undefined {
  return Deno.env.get(name) ?? undefined;
}

export function getEnvBoolean(name: string, defaultValue = false): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return defaultValue;
  return parseEnvBoolean(raw);
}
