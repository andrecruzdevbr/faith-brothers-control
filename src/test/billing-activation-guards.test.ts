import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { timingSafeEqualString } from "../../supabase/functions/_shared/timing-safe.ts";

const ROOT = resolve(process.cwd());

describe("billing activation guards — signup academy freeze", () => {
  it("does not rebind academy_id on complete_student_signup conflict", () => {
    const sql = readFileSync(
      resolve(ROOT, "supabase/migrations/20261026230000_freeze_signup_academy_id.sql"),
      "utf8",
    );
    expect(sql).toContain("complete_student_signup");
    expect(sql).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(sql).toContain("academy_id is intentionally not updated");
    expect(sql).not.toContain("academy_id = EXCLUDED.academy_id");
  });
});

describe("billing activation guards — leftover RLS", () => {
  it("drops permissive leftover policies and keeps student billing access via bill_staff_select", () => {
    const sql = readFileSync(
      resolve(ROOT, "supabase/migrations/20261026231000_drop_legacy_permissive_rls.sql"),
      "utf8",
    );
    expect(sql).toContain('DROP POLICY IF EXISTS "Users can view own academy" ON public.academies');
    expect(sql).toContain("public.is_admin_of_academy(id)");
    expect(sql).toContain('DROP POLICY IF EXISTS "Admins can manage academy billings" ON public.billings');
    expect(sql).toContain('DROP POLICY IF EXISTS "Admins can manage plans from own academy" ON public.plans');
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Users can update own profile or admins can update academy profiles" ON public.profiles',
    );
    expect(sql).toContain('DROP POLICY IF EXISTS "Admins can manage roles in their academy" ON public.user_roles');
    expect(sql).toContain("keep bill_admin_all + bill_staff_select");
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/DELETE FROM public\.(billings|students|profiles)/i);
  });

  it("keeps the intended student vs admin split in earlier replacements", () => {
    const finalization = readFileSync(
      resolve(ROOT, "supabase/migrations/20260627120000_production_finalization.sql"),
      "utf8",
    );
    expect(finalization).toContain("bill_staff_select");
    expect(finalization).toContain("public.can_access_billing(id)");
    expect(finalization).toContain("bill_admin_all");
    expect(finalization).toContain("public.is_admin_only(academy_id)");
    expect(finalization).toContain("prof_update");
    expect(finalization).toContain("ur_admin_insert");
  });
});

describe("billing activation guards — webhook token", () => {
  it("rejects mismatched secrets without accepting prefixes", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("ab", "abc")).toBe(false);
    expect(timingSafeEqualString(null, "abc")).toBe(false);
  });
});
