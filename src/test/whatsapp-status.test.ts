import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_EVOLUTION_HOST,
  LEGACY_EVOLUTION_HOST,
  WHATSAPP_STATUS_FUNCTION,
  interpretWhatsAppStatusError,
  interpretWhatsAppStatusResponse,
  isExpectedEvolutionHost,
  sanitizeWhatsAppStatusText,
} from "@/lib/whatsapp-status";

describe("isExpectedEvolutionHost", () => {
  it("accepts the HTTPS Production hostname with or without port", () => {
    expect(isExpectedEvolutionHost(EXPECTED_EVOLUTION_HOST)).toBe(true);
    expect(isExpectedEvolutionHost(`${EXPECTED_EVOLUTION_HOST}:443`)).toBe(true);
    expect(isExpectedEvolutionHost(`https://${EXPECTED_EVOLUTION_HOST}`)).toBe(true);
    expect(isExpectedEvolutionHost(`https://${EXPECTED_EVOLUTION_HOST}/`)).toBe(true);
  });

  it("accepts the legacy VPS IP during HTTPS cutover", () => {
    expect(isExpectedEvolutionHost(LEGACY_EVOLUTION_HOST)).toBe(true);
    expect(isExpectedEvolutionHost(`${LEGACY_EVOLUTION_HOST}:8080`)).toBe(true);
    expect(isExpectedEvolutionHost(`http://${LEGACY_EVOLUTION_HOST}:8080`)).toBe(true);
  });

  it("rejects local Docker, loopback and empty values", () => {
    expect(isExpectedEvolutionHost("host.docker.internal:8085")).toBe(false);
    expect(isExpectedEvolutionHost("localhost:8085")).toBe(false);
    expect(isExpectedEvolutionHost("127.0.0.1:8080")).toBe(false);
    expect(isExpectedEvolutionHost(null)).toBe(false);
    expect(isExpectedEvolutionHost("")).toBe(false);
    expect(isExpectedEvolutionHost("   ")).toBe(false);
  });

  it("rejects lookalike and malicious hostnames", () => {
    expect(isExpectedEvolutionHost(`${EXPECTED_EVOLUTION_HOST}.evil.example`)).toBe(false);
    expect(isExpectedEvolutionHost(`evil.${EXPECTED_EVOLUTION_HOST}`)).toBe(false);
    expect(isExpectedEvolutionHost("faithbrothers-wa.chickenkiller.com.attacker.test")).toBe(false);
    expect(isExpectedEvolutionHost(`${LEGACY_EVOLUTION_HOST}.evil.example`)).toBe(false);
    expect(isExpectedEvolutionHost(`https://${EXPECTED_EVOLUTION_HOST}@evil.example`)).toBe(false);
    expect(isExpectedEvolutionHost("https://evil.example/faithbrothers-wa.chickenkiller.com")).toBe(false);
  });

  it("rejects malformed server values", () => {
    expect(isExpectedEvolutionHost("://")).toBe(false);
    expect(isExpectedEvolutionHost("not a valid host")).toBe(false);
    expect(isExpectedEvolutionHost("http://")).toBe(false);
  });
});

describe("interpretWhatsAppStatusResponse", () => {
  it("maps connected: true to Conectado with instance and server", () => {
    const view = interpretWhatsAppStatusResponse({
      connected: true,
      state: "open",
      instance: "FaithBrothersAcademia",
      baseUrlHost: EXPECTED_EVOLUTION_HOST,
      sendEnabled: false,
    });
    expect(view.kind).toBe("connected");
    expect(view.label).toBe("Conectado");
    expect(view.instance).toBe("FaithBrothersAcademia");
    expect(view.server).toBe(EXPECTED_EVOLUTION_HOST);
    expect(view.unexpectedHost).toBe(false);
    expect(view.hostWarning).toBeNull();
  });

  it("treats the legacy VPS IP as an expected Production host", () => {
    const view = interpretWhatsAppStatusResponse({
      connected: true,
      state: "open",
      instance: "FaithBrothersAcademia",
      baseUrlHost: `${LEGACY_EVOLUTION_HOST}:8080`,
    });
    expect(view.unexpectedHost).toBe(false);
    expect(view.server).toBe(`${LEGACY_EVOLUTION_HOST}:8080`);
  });

  it("maps a successful payload without open session to Desconectado", () => {
    const view = interpretWhatsAppStatusResponse({
      connected: false,
      state: "close",
      instance: "FaithBrothersAcademia",
      baseUrlHost: EXPECTED_EVOLUTION_HOST,
    });
    expect(view.kind).toBe("disconnected");
    expect(view.label).toBe("Desconectado");
    expect(view.details).toContain("close");
  });

  it("warns when the returned host is not the Production VPS", () => {
    const view = interpretWhatsAppStatusResponse({
      connected: true,
      state: "open",
      instance: "FaithBrothersAcademia",
      baseUrlHost: "host.docker.internal:8085",
    });
    expect(view.unexpectedHost).toBe(true);
    expect(view.hostWarning).toContain("VPS de Production");
    expect(view.hostWarning).not.toMatch(/secret|apikey|token/i);
  });

  it("never surfaces API keys, JWTs or owner digits", () => {
    const view = interpretWhatsAppStatusResponse({
      connected: true,
      instance: "apikey=super-secret",
      baseUrlHost: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
      publicUrl: "http://example.invalid?apikey=leak",
    });
    const serialized = JSON.stringify(view);
    expect(view.instance).toBeNull();
    expect(view.server).toBeNull();
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(serialized).not.toContain("31999999999");
  });
});

describe("interpretWhatsAppStatusError", () => {
  it("maps auth errors to administrator login copy", () => {
    expect(interpretWhatsAppStatusError(new Error("Unauthorized")).details).toContain("administrador");
    expect(interpretWhatsAppStatusError(new Error("Forbidden")).details).toContain("administradores");
    expect(interpretWhatsAppStatusError(new Error("Não autenticado")).details).toContain("administrador");
  });

  it("maps timeout and network failures", () => {
    const timeout = new Error("ignored");
    timeout.name = "AbortError";
    expect(interpretWhatsAppStatusError(timeout).details).toContain("tempo limite");
    expect(interpretWhatsAppStatusError(new Error("Failed to fetch")).kind).toBe("error");
    expect(interpretWhatsAppStatusError(new Error("Failed to fetch")).label).toBe("Erro");
  });

  it("redacts secrets in error text", () => {
    const view = interpretWhatsAppStatusError(
      new Error("Invalid apikey=super-secret-key-value Bearer eyJhbGciOi.aaa.bbb"),
    );
    expect(JSON.stringify(view)).not.toContain("super-secret-key-value");
    expect(sanitizeWhatsAppStatusText("apikey=abc123")).toContain("[redacted]");
  });
});

describe("Configuracoes WhatsApp status wiring", () => {
  it("consults whatsapp-status with admin session and never uses send-whatsapp for connection", () => {
    const src = readFileSync("src/pages/Configuracoes.tsx", "utf8");
    expect(src).toContain("fetchWhatsAppStatus");
    expect(src).toContain("Verificar conexão");
    expect(src).toContain(WHATSAPP_STATUS_FUNCTION);
    expect(src).not.toMatch(/handleTestWhatsApp[\s\S]*whatsapp-status/);
    const connectionBlock = src.slice(src.indexOf("CONEXÃO WHATSAPP"));
    const connectionOnly = connectionBlock.slice(0, connectionBlock.indexOf("TESTAR WHATSAPP"));
    expect(connectionOnly).toContain("Verificar conexão");
    expect(connectionOnly).not.toContain("send-whatsapp");
    expect(connectionOnly).not.toContain("whatsapp_messages");
  });
});
