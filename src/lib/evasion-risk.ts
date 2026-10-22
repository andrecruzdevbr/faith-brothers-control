import { throwIfQueryFailed } from "@/lib/dashboard-view";

export type EvasionRiskLevel = "alto" | "medio" | "baixo";

export type EvasionRiskRow = {
  full_name: string;
  dias: number;
  risco: EvasionRiskLevel;
  reason: string;
};

export const EVASION_IDLE_DAYS = 14;
export const EVASION_RECENT_ATTENDANCE_DAYS = 7;

const MS_DAY = 86400000;

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function daysBetween(fromMs: number, now: Date): number {
  return Math.floor((now.getTime() - fromMs) / MS_DAY);
}

/** Newly enrolled students still inside the 14-day window without a first check-in. */
export function isAwaitingFirstAttendance(input: {
  lastAttendanceAt: string | null;
  createdAt: string | null | undefined;
  now: Date;
}): boolean {
  if (input.lastAttendanceAt) return false;
  const enrolledMs = parseTime(input.createdAt);
  if (enrolledMs == null) return false;
  return input.now.getTime() - enrolledMs < EVASION_IDLE_DAYS * MS_DAY;
}

export function buildEvasionRisk(input: {
  students: {
    data: Array<{ id: string; full_name: string; created_at?: string | null }> | null;
    error: { message: string } | null;
  };
  attendances: { data: Array<{ student_id: string; checked_in_at: string }> | null; error: { message: string } | null };
  overdueBills: { data: Array<{ student_id: string }> | null; error: { message: string } | null };
  now?: Date;
  limit?: number;
}): EvasionRiskRow[] {
  throwIfQueryFailed([input.students, input.attendances, input.overdueBills]);

  const now = input.now ?? new Date();
  const recentSince = new Date(now.getTime() - EVASION_RECENT_ATTENDANCE_DAYS * MS_DAY);
  const overdueSet = new Set((input.overdueBills.data ?? []).map((row) => row.student_id));
  const attMap = new Map<string, string[]>();
  for (const attendance of input.attendances.data ?? []) {
    const arr = attMap.get(attendance.student_id) ?? [];
    arr.push(attendance.checked_in_at);
    attMap.set(attendance.student_id, arr);
  }

  const results: EvasionRiskRow[] = [];
  for (const student of input.students.data ?? []) {
    const atts = attMap.get(student.id) ?? [];
    const lastAttMs = atts.length > 0 ? Math.max(...atts.map((d) => new Date(d).getTime())) : null;
    const enrolledMs = parseTime(student.created_at);
    const referenceMs = lastAttMs ?? enrolledMs;
    const dias = referenceMs != null ? daysBetween(referenceMs, now) : 99;
    const hasRecentAtt = atts.some((d) => new Date(d) >= recentSince);
    const hasOverdue = overdueSet.has(student.id);
    const awaitingFirst = isAwaitingFirstAttendance({
      lastAttendanceAt: lastAttMs != null ? new Date(lastAttMs).toISOString() : null,
      createdAt: student.created_at,
      now,
    });
    const idle14 = dias >= EVASION_IDLE_DAYS;

    if (awaitingFirst && !hasOverdue) continue;

    let risco: EvasionRiskLevel | null = null;
    let reason = "";
    if (awaitingFirst && hasOverdue) {
      risco = "baixo";
      reason = "Pagamento atrasado";
    } else if (idle14 && hasOverdue) {
      risco = "alto";
      reason = "Sem presença há 14+ dias + pagamento atrasado";
    } else if (idle14) {
      risco = "medio";
      reason = "Sem presença há 14+ dias";
    } else if (!hasRecentAtt && hasOverdue) {
      risco = "medio";
      reason = "Baixa frequência + pagamento atrasado";
    } else if (hasOverdue) {
      risco = "baixo";
      reason = "Pagamento atrasado";
    } else if (!hasRecentAtt) {
      risco = "baixo";
      reason = "Baixa frequência recente";
    }

    if (risco) results.push({ full_name: student.full_name, dias, risco, reason });
  }

  const order: Record<EvasionRiskLevel, number> = { alto: 0, medio: 1, baixo: 2 };
  return results.sort((a, b) => order[a.risco] - order[b.risco]).slice(0, input.limit ?? 5);
}
