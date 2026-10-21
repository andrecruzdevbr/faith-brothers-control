import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  billingStatusTransition,
  buildBillingUpdates,
} from "../../supabase/functions/_shared/asaas-webhook.ts";
import {
  BILLING_GENERATION_CLAIM_MARKER,
  decideBillingGenerationAction,
} from "../../supabase/functions/_shared/asaas-billing.ts";
import { authorizeSearchStudents } from "../../supabase/functions/_shared/search-students-auth.ts";
import { resolveStuckWhatsAppAction } from "../../supabase/functions/_shared/whatsapp.ts";

/** Files that belong to the audit-corrections release (must be the only ones published). */
export const AUDIT_RELEASE_PATHS = [
  "supabase/migrations/20261019120000_audit_security_finance_fixes.sql",
  "supabase/migrations/20261021120000_fix_family_rls_recursion.sql",
  "src/lib/family-access.ts",
  "src/lib/family-catalog-flags.ts",
  "src/lib/dashboard-view.ts",
  "src/lib/academy-finance.ts",
  "src/components/QueryLoadError.tsx",
  "src/test/family-rls.test.ts",
  "src/test/dashboard-stats.test.tsx",
  "src/test/family-catalog-flags.test.ts",
  "supabase/functions/_shared/asaas-billing.ts",
  "supabase/functions/_shared/asaas-webhook.ts",
  "supabase/functions/_shared/whatsapp.ts",
  "supabase/functions/_shared/search-students-auth.ts",
  "supabase/functions/_shared/password-reset.ts",
  "supabase/functions/generate-monthly-billings/index.ts",
  "supabase/functions/register-student/index.ts",
  "supabase/functions/asaas-webhook/index.ts",
  "supabase/functions/process-whatsapp-queue/index.ts",
  "supabase/functions/reset-password/index.ts",
  "src/App.tsx",
  "src/edge-runtime.d.ts",
  "src/index.css",
  "src/hooks/useQueries.ts",
  "src/integrations/supabase/types.ts",
  "src/lib/belt-events.ts",
  "src/lib/contracts.ts",
  "src/lib/finance-indicators.ts",
  "src/lib/registration-flows.ts",
  "src/lib/student-plan-situation.ts",
  "src/components/AdminNewStudentDialog.tsx",
  "src/components/StudentContractOverview.tsx",
  "src/components/family/FamilyRegistrationWizard.tsx",
  "src/pages/Cadastro.tsx",
  "src/pages/Configuracoes.tsx",
  "src/pages/Financeiro.tsx",
  "src/pages/MeuFinanceiro.tsx",
  "src/pages/Relatorios.tsx",
  "src/pages/Dashboard.tsx",
  "src/test/homologation-scope.test.ts",
  "src/test/audit-corrections.test.ts",
  "src/test/billing-concurrency.test.ts",
  "src/test/whatsapp-queue.test.ts",
  "src/test/search-students-auth.test.ts",
  "src/test/asaas-webhook.test.ts",
  "src/test/academy-finance.test.ts",
  "src/test/admin-new-student.test.ts",
  "src/test/official-veteran-catalog.test.ts",
  "src/test/register-student.test.ts",
  "src/test/student-birth-birthday.test.ts",
] as const;

/** Working-tree noise that must NOT ship with the audit release. */
export const EXCLUDE_FROM_AUDIT_RELEASE = [
  "ATUALIZACAO_TURMAS_HORARIOS.md",
  "CATALOGO_OFICIAL_NEW_STUDENT.md",
  "GO_LIVE_CATALOGO_NEW_STUDENT.md",
  "GO_LIVE_FLUXO_FAMILIAR_V2.md",
  "GO_LIVE_NOVO_VETERANO_PAGAMENTOS.md",
  "GO_LIVE_TURMAS_HORARIOS.md",
  "AUDITORIA_GERAL_PRE_ENTREGA.md",
  "GO_LIVE_AUDITORIA_FINAL.md",
  "GO_LIVE_FINAL.md",
  "PENDENCIAS_POS_APROVACAO_FINANCEIRO_WHATSAPP.md",
  "VALIDACAO_PRIMEIRO_PAGAMENTO_FAMILIAR_REAL.md",
  "scripts/backup-prepaid-20260807.sql",
  "scripts/smoke-prepaid-readiness.sql",
  "scripts/validate-prepaid-post-apply.sql",
  "scripts/go-live-cleanup-EXECUTE.sql",
  "scripts/family-v2-payment-wa-process.mjs",
  "supabase/.branches/_current_branch",
  ".env",
  ".env.local",
] as const;

describe("homologation — static migration dependencies", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261019120000_audit_security_finance_fixes.sql"),
    "utf8",
  );

  it("references existing helpers and prepaid APIs", () => {
    expect(sql).toContain("public.is_admin_only");
    expect(sql).toContain("public.can_access_student");
    expect(sql).toContain("public.get_my_academy_id");
    expect(sql).toContain("public.prepaid_ends_on");
    expect(sql).toContain("public.prepaid_coverage_months");
    expect(sql).toContain("familia_1");
    expect(sql).toContain("contract_status = 'expirado'");
  });

  it("keeps Edge-compatible privileges: service_role expire, authenticated belt RPC, no OTP client grants", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.expire_elapsed_student_contracts\(\) TO service_role/,
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_recent_belt_changes\(INTEGER\) TO authenticated/);
    expect(sql).not.toMatch(/GRANT .+ ON TABLE public\.otp_tokens TO authenticated/i);
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE public.whatsapp_messages");
  });

  it("creates belt trigger with SECURITY DEFINER and search_path", () => {
    expect(sql).toContain("log_student_belt_change");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain("trg_log_student_belt_change");
  });
});

describe("homologation — release scope hygiene", () => {
  it("all audit release paths exist locally", () => {
    for (const path of AUDIT_RELEASE_PATHS) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });

  it("documents excluded pre-existing / go-live noise paths", () => {
    expect(EXCLUDE_FROM_AUDIT_RELEASE.length).toBeGreaterThan(5);
    expect(EXCLUDE_FROM_AUDIT_RELEASE).toContain("scripts/go-live-cleanup-EXECUTE.sql");
    expect(EXCLUDE_FROM_AUDIT_RELEASE).toContain(".env");
    expect(EXCLUDE_FROM_AUDIT_RELEASE).toContain(".env.local");
  });

  it("includes the frontend webhook derivation (no hardcoded production ref)", () => {
    expect(AUDIT_RELEASE_PATHS).toContain("src/lib/academy-finance.ts");
    expect(AUDIT_RELEASE_PATHS).toContain("src/test/academy-finance.test.ts");
    const webhook = readFileSync(resolve(process.cwd(), "src/lib/academy-finance.ts"), "utf8");
    expect(webhook).toContain("VITE_SUPABASE_URL");
    expect(webhook).not.toContain("wojqjxtaqjasnfhbotxi");
  });
});

describe("homologation — synthetic authorization matrix", () => {
  it("blocks aluno-like anonymous search and cross-academy admin", () => {
    expect(authorizeSearchStudents({ academyId: "a1", authError: "Unauthorized" }).ok).toBe(false);
    expect(
      authorizeSearchStudents({ academyId: "a1", adminUserId: "u", adminAcademyId: "a2" }).ok,
    ).toBe(false);
    expect(
      authorizeSearchStudents({ academyId: "a1", adminUserId: "u", adminAcademyId: "a1" }).ok,
    ).toBe(true);
  });
});

describe("homologation — concurrent billing + WA + Asaas transitions", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");

  it("claim-before-asaas blocks concurrent create", () => {
    expect(decideBillingGenerationAction(null, now).action).toBe("create_claim");
    expect(
      decideBillingGenerationAction(
        {
          id: "x",
          status: "pendente",
          asaas_payment_id: null,
          last_error: BILLING_GENERATION_CLAIM_MARKER,
          updated_at: now.toISOString(),
        },
        now,
      ).action,
    ).toBe("in_progress");
  });

  it("late overdue/deleted cannot revert pago; refund can", () => {
    expect(billingStatusTransition("pago", "PAYMENT_OVERDUE")).toBeNull();
    expect(billingStatusTransition("pago", "PAYMENT_DELETED")).toBeNull();
    expect(billingStatusTransition("pago", "PAYMENT_REFUNDED")).toBe("cancelado");
    expect(buildBillingUpdates("PAYMENT_OVERDUE", now.toISOString())).toEqual({ status: "vencido" });
  });

  it("stuck WA with external id is mark_sent not reclaim", () => {
    expect(
      resolveStuckWhatsAppAction(
        {
          status: "processing",
          updated_at: new Date(now.getTime() - 180_000).toISOString(),
          external_id: "evo-1",
        },
        now,
      ),
    ).toBe("mark_sent");
  });
});
