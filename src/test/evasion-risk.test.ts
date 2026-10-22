import { describe, expect, it } from "vitest";
import { buildEvasionRisk } from "@/lib/evasion-risk";

const now = new Date("2026-10-21T12:00:00");

const ok = <T>(data: T) => ({ data, error: null as { message: string } | null });
const fail = (message: string) => ({ data: null, error: { message } });

describe("dashboard evasion query failures", () => {
  it("throws when the students query fails instead of returning no risk", () => {
    expect(() =>
      buildEvasionRisk({
        students: fail("permission denied for table students"),
        attendances: ok([]),
        overdueBills: ok([]),
        now,
      }),
    ).toThrow(/students/);
  });

  it("throws when attendances fail", () => {
    expect(() =>
      buildEvasionRisk({
        students: ok([{ id: "a", full_name: "Ana" }]),
        attendances: fail("Failed to fetch"),
        overdueBills: ok([]),
        now,
      }),
    ).toThrow(/Failed to fetch/);
  });

  it("throws when overdue billings fail", () => {
    expect(() =>
      buildEvasionRisk({
        students: ok([{ id: "a", full_name: "Ana" }]),
        attendances: ok([]),
        overdueBills: fail("infinite recursion"),
        now,
      }),
    ).toThrow(/infinite recursion/);
  });

  it("throws on combined failures", () => {
    expect(() =>
      buildEvasionRisk({
        students: fail("students down"),
        attendances: fail("attendances down"),
        overdueBills: fail("billings down"),
        now,
      }),
    ).toThrow(/students down/);
  });

  it("returns an empty list only when queries succeed with no risk", () => {
    expect(
      buildEvasionRisk({
        students: ok([{ id: "a", full_name: "Ana" }]),
        attendances: ok([{ student_id: "a", checked_in_at: now.toISOString() }]),
        overdueBills: ok([]),
        now,
      }),
    ).toEqual([]);
  });

  it("flags overdue without recent attendance as risk", () => {
    const rows = buildEvasionRisk({
      students: ok([{ id: "a", full_name: "Ana", created_at: "2026-08-01T12:00:00" }]),
      attendances: ok([]),
      overdueBills: ok([{ student_id: "a" }]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].risco).toBe("alto");
    expect(rows[0].reason).toBe("Sem presença há 14+ dias + pagamento atrasado");
  });
});

describe("dashboard evasion idle window", () => {
  it("does not treat a newly enrolled student without first attendance as 14+ day evasion", () => {
    const rows = buildEvasionRisk({
      students: ok([{ id: "n", full_name: "Novo Teste", created_at: "2026-10-20T12:00:00" }]),
      attendances: ok([]),
      overdueBills: ok([]),
      now,
    });
    expect(rows).toEqual([]);
  });

  it("keeps payment risk for a new student without calling it 14+ days idle", () => {
    const rows = buildEvasionRisk({
      students: ok([{ id: "n", full_name: "Novo Teste", created_at: "2026-10-20T12:00:00" }]),
      attendances: ok([]),
      overdueBills: ok([{ student_id: "n" }]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].risco).toBe("baixo");
    expect(rows[0].reason).toBe("Pagamento atrasado");
    expect(rows[0].dias).toBe(1);
  });

  it("flags a student enrolled 14+ days ago who never trained", () => {
    const rows = buildEvasionRisk({
      students: ok([{ id: "v", full_name: "Veterano Ausente", created_at: "2026-09-01T12:00:00" }]),
      attendances: ok([]),
      overdueBills: ok([]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].risco).toBe("medio");
    expect(rows[0].reason).toBe("Sem presença há 14+ dias");
    expect(rows[0].dias).toBeGreaterThanOrEqual(14);
  });

  it("flags interrupted training from last attendance, not enrollment date", () => {
    const rows = buildEvasionRisk({
      students: ok([{ id: "i", full_name: "Interrompeu", created_at: "2026-01-01T12:00:00" }]),
      attendances: ok([{ student_id: "i", checked_in_at: "2026-09-30T12:00:00" }]),
      overdueBills: ok([]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("Sem presença há 14+ dias");
    expect(rows[0].dias).toBe(21);
  });

  it("requires 14 elapsed days since enrollment before the idle label", () => {
    expect(
      buildEvasionRisk({
        students: ok([{ id: "a", full_name: "A", created_at: "2026-10-08T12:00:00" }]),
        attendances: ok([]),
        overdueBills: ok([]),
        now,
      }),
    ).toEqual([]);
    const rows = buildEvasionRisk({
      students: ok([{ id: "a", full_name: "A", created_at: "2026-10-07T12:00:00" }]),
      attendances: ok([]),
      overdueBills: ok([]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].dias).toBe(14);
    expect(rows[0].reason).toBe("Sem presença há 14+ dias");
  });

  it("does not use the 14+ day label when last training was 10 days ago", () => {
    const rows = buildEvasionRisk({
      students: ok([{ id: "a", full_name: "Ana", created_at: "2026-01-01T12:00:00" }]),
      attendances: ok([{ student_id: "a", checked_in_at: "2026-10-11T12:00:00" }]),
      overdueBills: ok([]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("Baixa frequência recente");
    expect(rows[0].dias).toBe(10);
  });
});
