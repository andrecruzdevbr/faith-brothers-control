import { describe, expect, it } from "vitest";
import {
  ASAAS_WEBHOOK_URL,
  formatAsaasEnvironmentLabel,
  formatFinanceDocumentDisplay,
  isLegacyFelipeFinanceContact,
} from "@/lib/academy-finance";

describe("academy finance display", () => {
  it("shows Ramon-ready labels and never treats Felipe as current finance contact", () => {
    expect(isLegacyFelipeFinanceContact("Felipe Nogueira")).toBe(true);
    expect(isLegacyFelipeFinanceContact("Ramon Pereira de São José")).toBe(false);
  });

  it("keeps CNPJ/MEI partial for display", () => {
    expect(formatFinanceDocumentDisplay("53.536.865/0001-XX")).toBe("53.536.865/0001-XX");
    expect(formatFinanceDocumentDisplay("")).toBe("Não informado");
  });

  it("maps environment label without exposing secrets", () => {
    expect(formatAsaasEnvironmentLabel("production")).toBe("Asaas Produção configurado");
    expect(formatAsaasEnvironmentLabel("sandbox")).toBe("Asaas Sandbox");
    expect(formatAsaasEnvironmentLabel(null)).toBe("Asaas (via Secrets)");
  });

  it("documents production webhook URL without tokens", () => {
    expect(ASAAS_WEBHOOK_URL).toContain("asaas-webhook");
    expect(ASAAS_WEBHOOK_URL).not.toMatch(/api[_-]?key/i);
    expect(ASAAS_WEBHOOK_URL).not.toContain("$");
  });
});
