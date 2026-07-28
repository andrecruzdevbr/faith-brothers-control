export type EvolutionConfig = {
  provider: string;
  sendEnabled: boolean;
  baseUrl: string;
  publicUrl: string | null;
  apiKey: string;
  instance: string;
};

type EnvMap = Record<string, string | undefined>;

export function parseEnvBoolean(value: string | undefined | null): boolean {
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveEnvValue(
  env: EnvMap,
  preferred: string,
  fallback?: string,
): string | undefined {
  const primary = env[preferred]?.trim();
  if (primary) return primary;
  if (fallback) {
    const secondary = env[fallback]?.trim();
    if (secondary) return secondary;
  }
  return undefined;
}

export function buildEvolutionSendTextPath(instance: string): string {
  return `/message/sendText/${instance}`;
}

export function buildEvolutionConnectionStatePath(instance: string): string {
  return `/instance/connectionState/${instance}`;
}

export function buildEvolutionSendTextUrl(baseUrl: string, instance: string): string {
  return `${stripTrailingSlash(baseUrl)}${buildEvolutionSendTextPath(instance)}`;
}

export function buildEvolutionConnectionStateUrl(baseUrl: string, instance: string): string {
  return `${stripTrailingSlash(baseUrl)}${buildEvolutionConnectionStatePath(instance)}`;
}

export function resolveEvolutionConfig(env: EnvMap): EvolutionConfig {
  const baseUrl = resolveEnvValue(env, "WHATSAPP_EVOLUTION_BASE_URL", "EVOLUTION_API_URL");
  const apiKey = resolveEnvValue(env, "WHATSAPP_EVOLUTION_API_KEY", "EVOLUTION_API_KEY");
  const instance = resolveEnvValue(env, "WHATSAPP_EVOLUTION_INSTANCE", "EVOLUTION_INSTANCE_NAME");
  const publicUrl = resolveEnvValue(env, "WHATSAPP_EVOLUTION_PUBLIC_URL") ?? null;
  const provider = resolveEnvValue(env, "WHATSAPP_PROVIDER") ?? "evolution";
  const sendEnabled = parseEnvBoolean(env.WHATSAPP_SEND_ENABLED);

  if (!baseUrl) throw new Error("WHATSAPP_EVOLUTION_BASE_URL (or EVOLUTION_API_URL) is not configured");
  if (!apiKey) throw new Error("WHATSAPP_EVOLUTION_API_KEY (or EVOLUTION_API_KEY) is not configured");
  if (!instance) throw new Error("WHATSAPP_EVOLUTION_INSTANCE (or EVOLUTION_INSTANCE_NAME) is not configured");

  return {
    provider,
    sendEnabled,
    baseUrl: stripTrailingSlash(baseUrl),
    publicUrl: publicUrl ? stripTrailingSlash(publicUrl) : null,
    apiKey,
    instance,
  };
}

export function isEvolutionConnected(state: string | null | undefined): boolean {
  return (state ?? "").toLowerCase() === "open";
}
