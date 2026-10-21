import { throwIfQueryFailed } from "@/lib/dashboard-view";

export type EvasionRiskLevel = "alto" | "medio" | "baixo";

export type EvasionRiskRow = {
  full_name: string;
  dias: number;
  risco: EvasionRiskLevel;
  reason: string;
};

export function buildEvasionRisk(input: {
  students: { data: Array<{ id: string; full_name: string }> | null; error: { message: string } | null };
  attendances: { data: Array<{ student_id: string; checked_in_at: string }> | null; error: { message: string } | null };
  overdueBills: { data: Array<{ student_id: string }> | null; error: { message: string } | null };
  now?: Date;
  limit?: number;
}): EvasionRiskRow[] {
  throwIfQueryFailed([input.students, input.attendances, input.overdueBills]);

  const now = input.now ?? new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);
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
    const lastAtt = atts.length > 0 ? new Date(Math.max(...atts.map((d) => new Date(d).getTime()))) : null;
    const dias = lastAtt ? Math.floor((now.getTime() - lastAtt.getTime()) / 86400000) : 99;
    const hasRecentAtt = atts.some((d) => new Date(d) >= oneWeekAgo);
    const hasOverdue = overdueSet.has(student.id);
    const noAtt14 = atts.length === 0;

    let risco: EvasionRiskLevel | null = null;
    let reason = "";
    if (noAtt14 && hasOverdue) {
      risco = "alto";
      reason = "Sem presença há 14+ dias + pagamento atrasado";
    } else if (noAtt14) {
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
