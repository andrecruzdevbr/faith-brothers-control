import { describe, expect, it } from "vitest";
import {
  buildFamilyWizardMemberPayload,
  countFamilyPractitioners,
  createEmptyMemberDraft,
  familyPerMemberShare,
  formatBeltDegreesLabel,
  formatBeltOnlyLabel,
  validateFamilyWizardMembers,
  validatePractitionerSports,
} from "@/lib/family-wizard";

describe("family registration v2", () => {
  it("requires at least one member when responsible trains unless Family 1 covers only the holder", () => {
    expect(validateFamilyWizardMembers([], { responsibleTrains: true }).ok).toBe(false);
    expect(
      validateFamilyWizardMembers([], {
        responsibleTrains: true,
        expectedPractitionerCount: 1,
      }).ok,
    ).toBe(true);
  });

  it("requires a practitioner member when responsible does not train", () => {
    expect(validateFamilyWizardMembers([], { responsibleTrains: false }).ok).toBe(false);
  });

  it("accepts minor dependents without typing guardian when holder name is known", () => {
    const member = {
      ...createEmptyMemberDraft(3),
      fullName: "Filho Um",
      birthDate: "2012-05-01",
      belt: "Cinza",
      degrees: 0,
      relationship: "filho",
      guardianName: "",
    };
    expect(
      validateFamilyWizardMembers([member], {
        responsibleTrains: false,
        financialResponsibleName: "André Silva",
      }).ok,
    ).toBe(true);
  });

  it("rejects minor dependents if holder name is missing", () => {
    const member = {
      ...createEmptyMemberDraft(3),
      fullName: "Filho Um",
      birthDate: "2012-05-01",
      belt: "Cinza",
      relationship: "filho",
      guardianName: "",
    };
    const result = validateFamilyWizardMembers([member], {
      responsibleTrains: false,
      financialResponsibleName: "",
    });
    expect(result.ok).toBe(false);
  });

  it("defaults degrees to 0 and rejects invalid degrees when provided", () => {
    expect(validatePractitionerSports({ belt: "Branca", degrees: 5, trainingDays: 3 })).toBeTruthy();
    expect(validatePractitionerSports({ belt: "Branca", degrees: 0, trainingDays: 3 })).toBeNull();
    expect(validatePractitionerSports({ belt: "Branca", trainingDays: 3 })).toBeNull();
  });

  it("rejects duplicate linked students", () => {
    const a = {
      ...createEmptyMemberDraft(2),
      mode: "link" as const,
      existingStudentId: "stu-1",
      fullName: "Já existe",
      belt: "Azul",
      degrees: 2,
    };
    const b = { ...a, key: "other" };
    const result = validateFamilyWizardMembers([a, b], { responsibleTrains: true });
    expect(result.ok).toBe(false);
  });

  it("builds payload with holder as guardian for all minor dependents", () => {
    const payload = buildFamilyWizardMemberPayload(
      [
        {
          key: "1",
          mode: "new",
          fullName: "Gabriel",
          birthDate: "2014-01-01",
          belt: "Branca",
          degrees: 0,
          trainingDays: 2,
          relationship: "filho",
          guardianName: "IGNORAR DIGITADO",
          notes: "obs",
        },
        {
          key: "2",
          mode: "new",
          fullName: "Laura",
          birthDate: "2016-06-01",
          belt: "Branca",
          degrees: 0,
          trainingDays: 3,
          relationship: "filha",
          guardianName: "",
          notes: "",
        },
        {
          key: "3",
          mode: "link",
          fullName: "Existente",
          birthDate: "",
          belt: "Azul",
          degrees: 1,
          trainingDays: 3,
          relationship: "filho",
          guardianName: "",
          notes: "",
          existingStudentId: "abc",
        },
      ],
      "André",
    );
    expect(payload[0]).toMatchObject({
      full_name: "Gabriel",
      guardian_name: "André",
      relationship: "filho",
    });
    expect(payload[1]).toMatchObject({
      full_name: "Laura",
      guardian_name: "André",
    });
    expect(payload[0]).not.toHaveProperty("billing_tax_id");
    expect(payload[0]).not.toHaveProperty("payment_method");
    expect(payload[0]).not.toHaveProperty("whatsapp");
    expect(payload[0]).not.toHaveProperty("email");
    expect(payload[1].guardian_name).toBe(payload[0].guardian_name);
    expect(payload[2]).toMatchObject({ existing_student_id: "abc", training_days: 3, degrees: 0 });
  });

  it("keeps adult dependent without guardian_name", () => {
    const payload = buildFamilyWizardMemberPayload(
      [
        {
          ...createEmptyMemberDraft(2),
          fullName: "Adulto",
          birthDate: "2000-01-01",
          relationship: "irmão",
          guardianName: "Não deve ir",
        },
      ],
      "André",
    );
    expect(payload[0].guardian_name).toBeNull();
  });

  it("counts practitioners without multiplying revenue share incorrectly", () => {
    expect(countFamilyPractitioners(true, 2)).toBe(3);
    expect(countFamilyPractitioners(false, 2)).toBe(2);
    expect(familyPerMemberShare(900, 3)).toBe(300);
    expect(formatBeltDegreesLabel("Azul", 2)).toBe("Azul, 2 graus");
    expect(formatBeltOnlyLabel("Azul")).toBe("Azul");
  });
});
