import { describe, expect, it } from "vitest";
import { authorizeSearchStudents } from "../../supabase/functions/_shared/search-students-auth.ts";
import { isMissingBeltChangesRpc } from "@/lib/belt-events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("search_students authorization", () => {
  it("rejects missing academy", () => {
    expect(authorizeSearchStudents({ academyId: "" })).toEqual({
      ok: false,
      status: 400,
      error: "Selecione uma academia.",
    });
  });

  it("rejects unauthenticated callers", () => {
    expect(
      authorizeSearchStudents({ academyId: "academy-1", authError: "Unauthorized" }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects admin from another academy", () => {
    expect(
      authorizeSearchStudents({
        academyId: "academy-1",
        adminUserId: "u1",
        adminAcademyId: "academy-2",
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("allows admin of the same academy", () => {
    expect(
      authorizeSearchStudents({
        academyId: "academy-1",
        adminUserId: "u1",
        adminAcademyId: "academy-1",
      }),
    ).toEqual({ ok: true });
  });
});

describe("belt events soft-fail", () => {
  it("detects missing RPC without inventing graduations", () => {
    expect(isMissingBeltChangesRpc({ code: "PGRST202", message: "Could not find the function" })).toBe(
      true,
    );
    expect(isMissingBeltChangesRpc({ message: "permission denied" })).toBe(false);
  });
});

describe("audit security migration review", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261019120000_audit_security_finance_fixes.sql"),
    "utf8",
  );

  it("drops the permissive wm_admin policy and blocks OTP from clients", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "wm_admin"');
    expect(sql).toContain("message_type IS DISTINCT FROM 'otp'");
    expect(sql).toContain("REVOKE ALL ON TABLE public.otp_tokens FROM anon, authenticated");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE public.whatsapp_messages FROM authenticated");
  });

  it("keeps belt RPC and expire function for service/admin paths", () => {
    expect(sql).toContain("get_recent_belt_changes");
    expect(sql).toContain("expire_elapsed_student_contracts");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.expire_elapsed_student_contracts() TO service_role");
    expect(sql).toContain("confirm_family_prepaid_payment");
  });

  it("does not grant OTP tables to authenticated", () => {
    expect(sql).not.toMatch(/GRANT\s+.*ON TABLE public\.otp_tokens\s+TO\s+authenticated/i);
    expect(sql).not.toMatch(/GRANT\s+.*ON TABLE public\.otp_rate_limits\s+TO\s+authenticated/i);
  });
});
