import { describe, it, expect } from "vitest";
import {
  extractStudentTaxId,
  formatBillingTaxIdLabel,
  hasBillableTaxId,
  isMissingBillingTaxId,
  isValidCnpj,
  isValidCpf,
  isValidTaxId,
  maskTaxId,
  normalizeTaxId,
  sanitizeBillingError,
} from "@/lib/tax-id";

/** CPF fictício válido (dígitos verificadores corretos). */
const VALID_CPF = "52998224725";
/** CNPJ fictício válido para testes. */
const VALID_CNPJ = "11222333000181";

describe("tax-id validation", () => {
  it("accepts valid 11-digit CPF", () => {
    expect(isValidCpf(VALID_CPF)).toBe(true);
    expect(isValidTaxId(VALID_CPF)).toBe(true);
    expect(normalizeTaxId("529.982.247-25")).toBe(VALID_CPF);
  });

  it("accepts valid 14-digit CNPJ", () => {
    expect(isValidCnpj(VALID_CNPJ)).toBe(true);
    expect(isValidTaxId(VALID_CNPJ)).toBe(true);
  });

  it("rejects invalid lengths and check digits", () => {
    expect(isValidTaxId("1234567890")).toBe(false);
    expect(isValidTaxId("11111111111")).toBe(false);
    expect(isValidTaxId("00000000000")).toBe(false);
    expect(isValidTaxId("12345678901234")).toBe(false);
    expect(isValidTaxId("00000000000000")).toBe(false);
    expect(isValidTaxId("11111111111111")).toBe(false);
  });

  it("masks tax id for display", () => {
    expect(maskTaxId(VALID_CPF)).toBe("***.***.***-25");
    expect(maskTaxId(VALID_CNPJ)).toBe("**.***.***/****-81");
  });
});

describe("student billing tax id extraction", () => {
  it("returns null when tax id is missing", () => {
    expect(extractStudentTaxId(null)).toBeNull();
    expect(extractStudentTaxId({ tax_id: null })).toBeNull();
    expect(hasBillableTaxId({ tax_id: null })).toBe(false);
  });

  it("reads object or array embed from PostgREST", () => {
    const profile = { tax_id: VALID_CPF };
    expect(extractStudentTaxId(profile)).toBe(VALID_CPF);
    expect(extractStudentTaxId([profile])).toBe(VALID_CPF);
    expect(hasBillableTaxId([profile])).toBe(true);
  });

  it("blocks Asaas charge path when tax id is missing", () => {
    const profile = { tax_id: null };
    const taxId = extractStudentTaxId(profile);
    expect(taxId).toBeNull();
    expect(hasBillableTaxId(profile)).toBe(false);
    const status = taxId ? "charge" : "skipped_missing_tax_id";
    expect(status).toBe("skipped_missing_tax_id");
  });
});

describe("student list tax id labels", () => {
  it("shows masked CPF/CNPJ when present", () => {
    expect(
      formatBillingTaxIdLabel({
        has_tax_id: true,
        masked: maskTaxId(VALID_CPF),
      }),
    ).toBe("***.***.***-25");
  });

  it("shows Não informado when missing", () => {
    expect(formatBillingTaxIdLabel({ has_tax_id: false, masked: null })).toBe("Não informado");
    expect(formatBillingTaxIdLabel(undefined)).toBe("Não informado");
    expect(isMissingBillingTaxId({ has_tax_id: false, masked: null })).toBe(true);
    expect(isMissingBillingTaxId({ has_tax_id: true, masked: "***.***.***-25" })).toBe(false);
  });
});

describe("sanitizeBillingError", () => {
  it("redacts document numbers from error messages", () => {
    const raw = `Asaas [400]: CPF ${VALID_CPF} inválido`;
    expect(sanitizeBillingError(raw)).not.toContain(VALID_CPF);
    expect(sanitizeBillingError(raw)).toContain("[documento]");
  });
});
