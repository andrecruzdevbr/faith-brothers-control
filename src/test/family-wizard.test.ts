import { describe, expect, it } from "vitest";
import {
  buildFamilyWizardMemberPayload,
  countFamilyPractitioners,
  createEmptyMemberDraft,
  familyPerMemberShare,
  formatBeltDegreesLabel,
  validateFamilyWizardMembers,
  validatePractitionerSports,
} from "@/lib/family-wizard";

describe("family registration v2", () => {
  it("requires at least one member even when responsible trains", () => {
    expect(validateFamilyWizardMembers([], { responsibleTrains: true }).ok).toBe(false);
  });

  it("requires a practitioner member when responsible does not train", () => {
    expect(validateFamilyWizardMembers([], { responsibleTrains: false }).ok).toBe(false);
  });

  it("accepts new members with belt/degrees and without WhatsApp/CPF", () => {
    const member = {
      ...createEmptyMemberDraft(3),
      fullName: "Filho Um",
      birthDate: "2012-05-01",
      belt: "Cinza",
      degrees: 1,
      relationship: "filho",
      guardianName: "Responsável Legal",
    };
    expect(validateFamilyWizardMembers([member], { responsibleTrains: false }).ok).toBe(true);
  });

  it("rejects invalid degrees", () => {
    expect(validatePractitionerSports({ belt: "Branca", degrees: 5, trainingDays: 3 })).toBeTruthy();
    expect(validatePractitionerSports({ belt: "Branca", degrees: 0, trainingDays: 3 })).toBeNull();
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

  it("builds payload without billing/whatsapp fields on members", () => {
    const payload = buildFamilyWizardMemberPayload([
      {
        key: "1",
        mode: "new",
        fullName: "Filha",
        birthDate: "2014-01-01",
        belt: "Branca",
        degrees: 0,
        trainingDays: 2,
        relationship: "filha",
        guardianName: "Mãe",
        notes: "obs",
      },
      {
        key: "2",
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
    ]);
    expect(payload[0]).toMatchObject({
      full_name: "Filha",
      birth_date: "2014-01-01",
      training_days: 2,
      belt: "Branca",
      degrees: 0,
      relationship: "filha",
    });
    expect(payload[0]).not.toHaveProperty("billing_tax_id");
    expect(payload[0]).not.toHaveProperty("payment_method");
    expect(payload[0]).not.toHaveProperty("whatsapp");
    expect(payload[1]).toMatchObject({ existing_student_id: "abc", training_days: 3, degrees: 1 });
  });

  it("counts practitioners without multiplying revenue share incorrectly", () => {
    expect(countFamilyPractitioners(true, 2)).toBe(3);
    expect(countFamilyPractitioners(false, 2)).toBe(2);
    expect(familyPerMemberShare(900, 3)).toBe(300);
    expect(formatBeltDegreesLabel("Azul", 2)).toBe("Azul, 2 graus");
  });
});
