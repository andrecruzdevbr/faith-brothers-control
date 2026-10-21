/** Pure authorization for register-student action search_students. */

export type SearchStudentsAuthResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403; error: string };

export function authorizeSearchStudents(params: {
  academyId: string;
  adminUserId?: string | null;
  adminAcademyId?: string | null;
  authError?: string | null;
}): SearchStudentsAuthResult {
  if (!params.academyId.trim()) {
    return { ok: false, status: 400, error: "Selecione uma academia." };
  }
  if (params.authError) {
    const status = params.authError === "Forbidden" ? 403 : 401;
    return {
      ok: false,
      status,
      error: "Somente administrador da academia pode buscar alunos.",
    };
  }
  if (!params.adminUserId) {
    return {
      ok: false,
      status: 401,
      error: "Somente administrador da academia pode buscar alunos.",
    };
  }
  if (!params.adminAcademyId || params.adminAcademyId !== params.academyId) {
    return {
      ok: false,
      status: 403,
      error: "Academia não autorizada para este administrador.",
    };
  }
  return { ok: true };
}
