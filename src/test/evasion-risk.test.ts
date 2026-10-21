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
      students: ok([{ id: "a", full_name: "Ana" }]),
      attendances: ok([]),
      overdueBills: ok([{ student_id: "a" }]),
      now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].risco).toBe("alto");
  });
});
