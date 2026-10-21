import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canMutateFamilyMember,
  canSelectFamilyGroup,
  canSelectFamilyMember,
  canSelectStudentContract,
  type FamilyAccessActor,
  type FamilyGroupRow,
  type FamilyMemberRow,
  type StudentContractRow,
} from "@/lib/family-access";

const MIGRATION = "supabase/migrations/20261021120000_fix_family_rls_recursion.sql";

const academyA = "academy-a";
const academyB = "academy-b";
const groupA: FamilyGroupRow = { id: "group-a", academyId: academyA };
const groupB: FamilyGroupRow = { id: "group-b", academyId: academyB };

const adminA: FamilyAccessActor = { userId: "admin-a", academyId: academyA, role: "admin" };
const adminB: FamilyAccessActor = { userId: "admin-b", academyId: academyB, role: "admin" };
const alunoA: FamilyAccessActor = { userId: "aluno-a", academyId: academyA, role: "aluno" };
const alunoOutsider: FamilyAccessActor = { userId: "aluno-x", academyId: academyA, role: "aluno" };

const members: FamilyMemberRow[] = [
  {
    id: "m-a",
    familyGroupId: groupA.id,
    studentId: "stu-a",
    studentAcademyId: academyA,
    studentProfileUserId: alunoA.userId,
    status: "ativo",
  },
  {
    id: "m-sib",
    familyGroupId: groupA.id,
    studentId: "stu-sib",
    studentAcademyId: academyA,
    studentProfileUserId: "aluno-sib",
    status: "ativo",
  },
  {
    id: "m-b",
    familyGroupId: groupB.id,
    studentId: "stu-b",
    studentAcademyId: academyB,
    studentProfileUserId: "aluno-b",
    status: "ativo",
  },
];

const contractA: StudentContractRow = {
  id: "c-a",
  academyId: academyA,
  studentId: "stu-a",
  studentProfileUserId: alunoA.userId,
  familyGroupId: groupA.id,
};
const contractB: StudentContractRow = {
  id: "c-b",
  academyId: academyB,
  studentId: "stu-b",
  studentProfileUserId: "aluno-b",
  familyGroupId: groupB.id,
};

describe("family RLS migration 20261021120000", () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

  it("introduces SECURITY DEFINER helpers and does not use permissive USING (true)", () => {
    expect(sql).toContain("public.is_active_family_member");
    expect(sql).toContain("public.is_admin_of_family_group");
    expect(sql).toContain("public.is_admin_only_of_family_group");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });

  it("stops family_groups_select from reading family_members under RLS", () => {
    const policy = sql.slice(sql.indexOf("CREATE POLICY family_groups_select"));
    const body = policy.slice(0, policy.indexOf(";", policy.indexOf("USING")));
    expect(body).toContain("public.is_admin_of_academy(academy_id)");
    expect(body).toContain("public.is_active_family_member(id)");
    expect(body).not.toMatch(/FROM\s+public\.family_members/i);
  });

  it("stops family_members_select from reading family_groups under RLS", () => {
    const policy = sql.slice(sql.indexOf("CREATE POLICY family_members_select"));
    const body = policy.slice(0, policy.indexOf(";", policy.indexOf("USING")));
    expect(body).toContain("public.can_access_student(student_id)");
    expect(body).toContain("public.is_admin_of_family_group(family_group_id)");
    expect(body).not.toMatch(/FROM\s+public\.family_groups/i);
  });

  it("stops student_contracts_select from reading family_members under RLS", () => {
    const policy = sql.slice(sql.indexOf("CREATE POLICY student_contracts_select"));
    const body = policy.slice(0, policy.indexOf(";", policy.indexOf("USING")));
    expect(body).toContain("public.is_admin_of_academy(academy_id)");
    expect(body).toContain("public.can_access_student(student_id)");
    expect(body).toContain("public.is_active_family_member(family_group_id)");
    expect(body).not.toMatch(/FROM\s+public\.family_members/i);
  });
});

describe("family authorization matrix — cross-academy", () => {
  it("lets academy admin read own groups/members/contracts and mutate members", () => {
    expect(canSelectFamilyGroup(adminA, groupA, members)).toBe(true);
    expect(canSelectFamilyMember(adminA, members[0], groupA)).toBe(true);
    expect(canSelectFamilyMember(adminA, members[1], groupA)).toBe(true);
    expect(canMutateFamilyMember(adminA, groupA)).toBe(true);
    expect(canSelectStudentContract(adminA, contractA, members)).toBe(true);
  });

  it("blocks academy admin from the other academy", () => {
    expect(canSelectFamilyGroup(adminA, groupB, members)).toBe(false);
    expect(canSelectFamilyMember(adminA, members[2], groupB)).toBe(false);
    expect(canMutateFamilyMember(adminA, groupB)).toBe(false);
    expect(canSelectStudentContract(adminA, contractB, members)).toBe(false);
    expect(canSelectFamilyGroup(adminB, groupA, members)).toBe(false);
  });

  it("lets a member aluno read own group and own contract, not siblings or other academies", () => {
    expect(canSelectFamilyGroup(alunoA, groupA, members)).toBe(true);
    expect(canSelectFamilyMember(alunoA, members[0], groupA)).toBe(true);
    expect(canSelectFamilyMember(alunoA, members[1], groupA)).toBe(false);
    expect(canMutateFamilyMember(alunoA, groupA)).toBe(false);
    expect(canSelectStudentContract(alunoA, contractA, members)).toBe(true);
    expect(canSelectFamilyGroup(alunoA, groupB, members)).toBe(false);
    expect(canSelectStudentContract(alunoA, contractB, members)).toBe(false);
  });

  it("blocks a non-member aluno of the same academy", () => {
    expect(canSelectFamilyGroup(alunoOutsider, groupA, members)).toBe(false);
    expect(canSelectFamilyMember(alunoOutsider, members[0], groupA)).toBe(false);
    expect(canSelectStudentContract(alunoOutsider, contractA, members)).toBe(false);
  });
});
