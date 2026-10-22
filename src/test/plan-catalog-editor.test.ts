import { describe, expect, it } from "vitest";
import {
  FAMILY_PLAN_EDIT_BLOCKED_MESSAGE,
  buildCatalogPlanWrite,
  buggyCoerceAudienceToNewStudent,
  catalogPlanEditBlockReason,
  draftFromCatalogPlan,
  mapAudienceForEditor,
  type CatalogEditorDraft,
  type CatalogPlanRecord,
} from "@/lib/plan-catalog-editor";

const familyPlan: CatalogPlanRecord = {
  id: "fam-1",
  name: "Plano Familiar 1 — 1 dia por semana",
  audience: "familia",
  plan_kind: "mensal",
  training_days_per_week: 1,
  monthly_price: 280,
  package_total_amount: 280,
  duration_months: 1,
  billing_mode: "machine_prepaid",
  allows_installments: true,
  max_installments: 12,
  reference_monthly_price: 280,
  active: true,
};

const newStudentPlan: CatalogPlanRecord = {
  id: "ns-1",
  name: "Plano 3 dias por semana",
  audience: "new_student",
  plan_kind: "mensal",
  training_days_per_week: 3,
  monthly_price: 230,
  package_total_amount: null,
  duration_months: 1,
  billing_mode: "asaas_monthly",
  allows_installments: false,
  max_installments: 1,
  reference_monthly_price: 230,
  active: true,
};

const veteranPlan: CatalogPlanRecord = {
  id: "vet-1",
  name: "Plano Veterano Semestral 3 dias",
  audience: "veterano",
  plan_kind: "semestral",
  training_days_per_week: 3,
  monthly_price: 200,
  package_total_amount: 1200,
  duration_months: 6,
  billing_mode: "machine_prepaid",
  allows_installments: true,
  max_installments: 12,
  reference_monthly_price: 200,
  active: false,
};

const draft: CatalogEditorDraft = {
  name: "Edited",
  audience: "new_student",
  plan_kind: "mensal",
  training_days_per_week: "5",
  price: "999",
  active: "true",
};

describe("plan catalog editor — audience safety", () => {
  it("reproduces the homolog bug that coerced familia to new_student", () => {
    expect(buggyCoerceAudienceToNewStudent("familia")).toBe("new_student");
  });

  it("does not map familia into the editor audience", () => {
    expect(mapAudienceForEditor("familia")).toBeNull();
    expect(mapAudienceForEditor("new_student")).toBe("new_student");
    expect(mapAudienceForEditor("veterano")).toBe("veterano");
  });

  it("blocks family prepaid edits instead of rewriting billing_mode", () => {
    expect(catalogPlanEditBlockReason(familyPlan)).toBe(FAMILY_PLAN_EDIT_BLOCKED_MESSAGE);
    const write = buildCatalogPlanWrite({
      mode: "update",
      academyId: "academy",
      draft,
      original: familyPlan,
    });
    expect(write.ok).toBe(false);
    if ("blocked" in write) expect(write.blocked).toBe(FAMILY_PLAN_EDIT_BLOCKED_MESSAGE);
  });
});

describe("plan catalog editor — new student", () => {
  it("preserves official monthly Asaas fields on edit", () => {
    const write = buildCatalogPlanWrite({
      mode: "update",
      academyId: "academy",
      draft: { ...draft, name: "Plano 3 dias por semana", price: "230" },
      original: newStudentPlan,
    });
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    expect(write.payload.audience).toBe("new_student");
    expect(write.payload.plan_kind).toBe("mensal");
    expect(write.payload.billing_mode).toBe("asaas_monthly");
    expect(write.payload.duration_months).toBe(1);
    expect(write.payload.training_days_per_week).toBe(3);
    expect(write.payload.package_total_amount).toBeNull();
    expect(write.payload.monthly_price).toBe(230);
  });

  it("ignores draft audience/kind/frequency that would rewrite the official plan", () => {
    const write = buildCatalogPlanWrite({
      mode: "update",
      academyId: "academy",
      draft,
      original: newStudentPlan,
    });
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    expect(write.payload.audience).toBe("new_student");
    expect(write.payload.plan_kind).toBe("mensal");
    expect(write.payload.training_days_per_week).toBe(3);
    expect(write.payload.billing_mode).toBe("asaas_monthly");
  });
});

describe("plan catalog editor — veteran prepaid", () => {
  it("keeps machine_prepaid duration and package total", () => {
    const write = buildCatalogPlanWrite({
      mode: "update",
      academyId: "academy",
      draft: { ...draft, audience: "veterano", plan_kind: "mensal", price: "1200" },
      original: veteranPlan,
    });
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    expect(write.payload.audience).toBe("veterano");
    expect(write.payload.plan_kind).toBe("semestral");
    expect(write.payload.billing_mode).toBe("machine_prepaid");
    expect(write.payload.duration_months).toBe(6);
    expect(write.payload.training_days_per_week).toBe(3);
    expect(write.payload.package_total_amount).toBe(1200);
    expect(write.payload.monthly_price).toBe(200);
  });
});

describe("plan catalog editor — draft loading", () => {
  it("refuses to load a family plan into the form", () => {
    const next = draftFromCatalogPlan(familyPlan);
    expect(next).toEqual({ blocked: FAMILY_PLAN_EDIT_BLOCKED_MESSAGE });
  });

  it("loads new student and veteran drafts without coercing audience", () => {
    const ns = draftFromCatalogPlan(newStudentPlan);
    const vet = draftFromCatalogPlan(veteranPlan);
    expect("blocked" in ns).toBe(false);
    expect("blocked" in vet).toBe(false);
    if ("blocked" in ns || "blocked" in vet) return;
    expect(ns.audience).toBe("new_student");
    expect(vet.audience).toBe("veterano");
    expect(vet.plan_kind).toBe("semestral");
  });

  it("blocks drop-in plans", () => {
    expect(
      catalogPlanEditBlockReason({
        audience: "new_student",
        plan_kind: "mensal",
        billing_mode: "machine_dropin",
      }),
    ).toMatch(/avulsos/i);
  });
});
