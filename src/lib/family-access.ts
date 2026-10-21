/** Authorization matrix mirrored by migration 20261021120000 (family RLS helpers). */

export type FamilyAccessActor = {
  userId: string;
  academyId: string;
  role: "admin" | "aluno";
};

export type FamilyGroupRow = {
  id: string;
  academyId: string;
};

export type FamilyMemberRow = {
  id: string;
  familyGroupId: string;
  studentId: string;
  studentAcademyId: string;
  studentProfileUserId: string | null;
  status: "pendente" | "ativo" | "inativo";
};

export type StudentContractRow = {
  id: string;
  academyId: string;
  studentId: string | null;
  studentProfileUserId: string | null;
  familyGroupId: string | null;
};

export function isAdminOfAcademy(actor: FamilyAccessActor, academyId: string): boolean {
  return actor.role === "admin" && actor.academyId === academyId;
}

export function isActiveFamilyMember(
  actor: FamilyAccessActor,
  members: FamilyMemberRow[],
  familyGroupId: string,
): boolean {
  return members.some(
    (m) =>
      m.familyGroupId === familyGroupId
      && m.studentProfileUserId === actor.userId
      && (m.status === "pendente" || m.status === "ativo"),
  );
}

export function canSelectFamilyGroup(
  actor: FamilyAccessActor,
  group: FamilyGroupRow,
  members: FamilyMemberRow[],
): boolean {
  return isAdminOfAcademy(actor, group.academyId) || isActiveFamilyMember(actor, members, group.id);
}

export function canSelectFamilyMember(
  actor: FamilyAccessActor,
  member: FamilyMemberRow,
  group: FamilyGroupRow,
): boolean {
  if (member.familyGroupId !== group.id) return false;
  if (member.studentProfileUserId === actor.userId) return true;
  return isAdminOfAcademy(actor, group.academyId);
}

export function canMutateFamilyMember(
  actor: FamilyAccessActor,
  group: FamilyGroupRow,
): boolean {
  return isAdminOfAcademy(actor, group.academyId);
}

export function canSelectStudentContract(
  actor: FamilyAccessActor,
  contract: StudentContractRow,
  members: FamilyMemberRow[],
): boolean {
  if (isAdminOfAcademy(actor, contract.academyId)) return true;
  if (contract.studentId && contract.studentProfileUserId === actor.userId) return true;
  if (contract.familyGroupId && isActiveFamilyMember(actor, members, contract.familyGroupId)) {
    return true;
  }
  return false;
}
