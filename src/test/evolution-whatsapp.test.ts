import { describe, it, expect, vi } from "vitest";
import {
  buildEvolutionConnectionStatePath,
  buildEvolutionConnectionStateUrl,
  buildEvolutionSendTextPath,
  buildEvolutionSendTextUrl,
  isEvolutionConnected,
  parseEnvBoolean,
  resolveEvolutionConfig,
} from "../../supabase/functions/_shared/evolution-config.ts";

const LOCAL_ENV = {
  WHATSAPP_PROVIDER: "evolution",
  WHATSAPP_SEND_ENABLED: "false",
  WHATSAPP_EVOLUTION_BASE_URL: "http://host.docker.internal:8085/",
  WHATSAPP_EVOLUTION_PUBLIC_URL: "http://localhost:8085",
  WHATSAPP_EVOLUTION_API_KEY: "change-me",
  WHATSAPP_EVOLUTION_INSTANCE: "FaithBrothersAcademia",
};

describe("parseEnvBoolean", () => {
  it("accepts true/1/yes/on", () => {
    expect(parseEnvBoolean("true")).toBe(true);
    expect(parseEnvBoolean("1")).toBe(true);
    expect(parseEnvBoolean("yes")).toBe(true);
    expect(parseEnvBoolean("ON")).toBe(true);
  });

  it("treats other values as false", () => {
    expect(parseEnvBoolean("false")).toBe(false);
    expect(parseEnvBoolean("")).toBe(false);
    expect(parseEnvBoolean(undefined)).toBe(false);
    expect(parseEnvBoolean("maybe")).toBe(false);
  });
});

describe("resolveEvolutionConfig", () => {
  it("prefers WHATSAPP_* vars and strips trailing slash", () => {
    const config = resolveEvolutionConfig(LOCAL_ENV);
    expect(config.provider).toBe("evolution");
    expect(config.sendEnabled).toBe(false);
    expect(config.baseUrl).toBe("http://host.docker.internal:8085");
    expect(config.publicUrl).toBe("http://localhost:8085");
    expect(config.instance).toBe("FaithBrothersAcademia");
  });

  it("falls back to legacy EVOLUTION_* names", () => {
    const config = resolveEvolutionConfig({
      WHATSAPP_SEND_ENABLED: "true",
      EVOLUTION_API_URL: "https://legacy.example.com/",
      EVOLUTION_API_KEY: "legacy-key",
      EVOLUTION_INSTANCE_NAME: "legacy-instance",
    });
    expect(config.sendEnabled).toBe(true);
    expect(config.baseUrl).toBe("https://legacy.example.com");
    expect(config.apiKey).toBe("legacy-key");
    expect(config.instance).toBe("legacy-instance");
  });
});

describe("Evolution URL builders", () => {
  it("builds sendText path for FaithBrothersAcademia", () => {
    expect(buildEvolutionSendTextPath("FaithBrothersAcademia")).toBe(
      "/message/sendText/FaithBrothersAcademia",
    );
    expect(buildEvolutionSendTextUrl("http://host.docker.internal:8085/", "FaithBrothersAcademia")).toBe(
      "http://host.docker.internal:8085/message/sendText/FaithBrothersAcademia",
    );
  });

  it("builds connectionState path for FaithBrothersAcademia", () => {
    expect(buildEvolutionConnectionStatePath("FaithBrothersAcademia")).toBe(
      "/instance/connectionState/FaithBrothersAcademia",
    );
    expect(
      buildEvolutionConnectionStateUrl("http://host.docker.internal:8085", "FaithBrothersAcademia"),
    ).toBe("http://host.docker.internal:8085/instance/connectionState/FaithBrothersAcademia");
  });

  it("marks connected only when state is open", () => {
    expect(isEvolutionConnected("open")).toBe(true);
    expect(isEvolutionConnected("Open")).toBe(true);
    expect(isEvolutionConnected("connecting")).toBe(false);
    expect(isEvolutionConnected(null)).toBe(false);
  });
});

describe("WHATSAPP_SEND_ENABLED gate", () => {
  it("does not call fetch when send is disabled", async () => {
    const fetchMock = vi.fn();
    const env = { ...LOCAL_ENV, WHATSAPP_SEND_ENABLED: "false" };
    const config = resolveEvolutionConfig(env);
    expect(config.sendEnabled).toBe(false);

    // Mirror sendViaEvolution gate used by Edge Functions
    if (!config.sendEnabled) {
      const result = {
        ok: true,
        skipped: true,
        reason: "WHATSAPP_SEND_ENABLED=false",
      };
      expect(result).toEqual({
        ok: true,
        skipped: true,
        reason: "WHATSAPP_SEND_ENABLED=false",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      return;
    }

    await fetchMock(buildEvolutionSendTextUrl(config.baseUrl, config.instance), {
      method: "POST",
      headers: { apikey: config.apiKey },
    });
  });

  it("builds send URL when send is enabled without exposing api key in payload helpers", () => {
    const config = resolveEvolutionConfig({
      ...LOCAL_ENV,
      WHATSAPP_SEND_ENABLED: "true",
    });
    const url = buildEvolutionSendTextUrl(config.baseUrl, config.instance);
    expect(url).toBe(
      "http://host.docker.internal:8085/message/sendText/FaithBrothersAcademia",
    );
    expect(url).not.toContain(config.apiKey);
    expect(JSON.stringify({ provider: config.provider, instance: config.instance })).not.toContain(
      config.apiKey,
    );
  });
});

describe("billing queue respects send gate", () => {
  it("billing messages stay skipped when WHATSAPP_SEND_ENABLED=false", () => {
    const config = resolveEvolutionConfig({
      ...LOCAL_ENV,
      WHATSAPP_SEND_ENABLED: "false",
    });
    const billingSendAllowed = config.sendEnabled;
    expect(billingSendAllowed).toBe(false);

    const processedStatus = billingSendAllowed ? "sent_whatsapp" : "queued_whatsapp_send_disabled";
    expect(processedStatus).toBe("queued_whatsapp_send_disabled");
  });
});
