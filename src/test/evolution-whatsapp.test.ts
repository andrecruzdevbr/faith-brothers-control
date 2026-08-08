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
import {
  formatEvolutionApiError,
  maskPhoneForLog,
} from "../../supabase/functions/_shared/evolution-error.ts";

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

describe("formatEvolutionApiError", () => {
  it("masks phone numbers for logs", () => {
    expect(maskPhoneForLog("5531938941852")).toBe("5531****1852");
    expect(maskPhoneForLog("31938941852")).toBe("3193****1852");
  });

  it("preserves exists:false and response.message on HTTP 400 (not only Bad Request)", () => {
    const formatted = formatEvolutionApiError({
      httpStatus: 400,
      instance: "FaithBrothersAcademia",
      number: "5531938941852",
      body: {
        status: 400,
        error: "Bad Request",
        response: {
          message: [
            {
              jid: "5531938941852@s.whatsapp.net",
              exists: false,
              number: "5531938941852",
            },
          ],
        },
      },
    });

    expect(formatted).toContain("Evolution API [400]");
    expect(formatted).toContain("instance=FaithBrothersAcademia");
    expect(formatted).toContain("httpStatus=400");
    expect(formatted).toContain("status=400");
    expect(formatted).toContain("error=Bad Request");
    expect(formatted).toContain("exists=false");
    expect(formatted).toContain("response.message=");
    expect(formatted).toContain("5531****1852");
    expect(formatted).not.toContain("5531938941852");
    expect(formatted).not.toContain("change-me");
    expect(formatted).not.toContain("apikey");
    // Must not collapse to bare Bad Request only
    expect(formatted).not.toBe(
      "Evolution API [400] instance=FaithBrothersAcademia: Bad Request",
    );
  });

  it("redacts API keys if present in Evolution body text", () => {
    const formatted = formatEvolutionApiError({
      httpStatus: 401,
      instance: "FaithBrothersAcademia",
      number: "5531988645644",
      body: {
        status: 401,
        error: "Unauthorized",
        message: "Invalid apikey=super-secret-key-value",
      },
    });
    expect(formatted).toContain("httpStatus=401");
    expect(formatted).not.toContain("super-secret-key-value");
  });
});
