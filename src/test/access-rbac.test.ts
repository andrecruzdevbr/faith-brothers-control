import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  getHomePath,
  isAcademyLimitedRole,
  isAdminRole,
  isStaffRole,
} from "@/lib/access";
import { ACADEMY_LIMITED_PATHS } from "@/lib/constants";

describe("academy_limited access", () => {
  const limited = ["academy_limited"] as const;
  const admin = ["admin", "professor"] as const;
  const professor = ["professor"] as const;

  it("treats academy_limited as limited (not admin/staff)", () => {
    expect(isAcademyLimitedRole([...limited])).toBe(true);
    expect(isAdminRole([...limited])).toBe(false);
    expect(isStaffRole([...limited])).toBe(false);
  });

  it("homes limited users to /turmas", () => {
    expect(getHomePath([...limited])).toBe("/turmas");
    expect(getHomePath([...admin])).toBe("/dashboard");
  });

  it("allows only ops + basic settings for limited", () => {
    for (const path of ACADEMY_LIMITED_PATHS) {
      expect(canAccessPath([...limited], path)).toBe(true);
    }
    expect(canAccessPath([...limited], "/financeiro")).toBe(false);
    expect(canAccessPath([...limited], "/alunos")).toBe(false);
    expect(canAccessPath([...limited], "/professores")).toBe(false);
    expect(canAccessPath([...limited], "/relatorios")).toBe(false);
    expect(canAccessPath([...limited], "/dashboard")).toBe(false);
  });

  it("keeps full access for admin and ops for professor", () => {
    expect(canAccessPath([...admin], "/financeiro")).toBe(true);
    expect(canAccessPath([...admin], "/configuracoes")).toBe(true);
    expect(canAccessPath([...professor], "/turmas")).toBe(true);
    expect(canAccessPath([...professor], "/financeiro")).toBe(false);
  });
});

describe("academy_limited basic academy info contract", () => {
  it("exposes only safe fields from get_my_academy_basic_info", () => {
    const allowed = ["id", "name", "slug", "city", "state", "address"] as const;
    const forbidden = [
      "bank_name",
      "bank_code",
      "bank_branch",
      "bank_account",
      "finance_whatsapp",
      "finance_contact_name",
      "finance_document_display",
      "asaas_environment_label",
    ] as const;

    expect(allowed).toHaveLength(6);
    for (const field of forbidden) {
      expect((allowed as readonly string[]).includes(field)).toBe(false);
    }
  });
});
