import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SCHEDULE_EXPECTATIONS,
  displayClassNotes,
  CLASS_SCHEDULE_FILTER_EMPTY,
  CLASS_SCHEDULE_IDLE_EMPTY,
  classScheduleEmptyMessage,
  filterClassSchedules,
  findScheduleSlot,
  formatStartTime,
  groupClassSchedulesByDay,
  isNogi,
  persistClassNotes,
  type ClassScheduleRow,
} from "@/lib/class-schedules";

function buildOfficialFixture(): ClassScheduleRow[] {
  return OFFICIAL_SCHEDULE_EXPECTATIONS.map((slot, index) => ({
    id: `slot-${index}`,
    academy_id: "academy",
    name:
      slot.audience === "infantil"
        ? "Infantil"
        : slot.audience === "feminino"
          ? "Feminino"
          : "Adulto iniciante/avançado",
    day_of_week: slot.day,
    start_time: `${slot.time}:00`,
    audience: slot.audience,
    level: slot.audience === "adulto" ? "iniciante_avancado" : null,
    modality: slot.modality,
    notes: null,
    sort_order: index,
    active: true,
  }));
}

describe("official class schedules", () => {
  const rows = buildOfficialFixture();

  it("has exactly 23 official slots", () => {
    expect(rows).toHaveLength(23);
    expect(OFFICIAL_SCHEDULE_EXPECTATIONS).toHaveLength(23);
  });

  it.each(OFFICIAL_SCHEDULE_EXPECTATIONS)(
    "matches $day $time $audience $modality",
    (expected) => {
      const found = findScheduleSlot(rows, expected.day, expected.time);
      expect(found).toBeTruthy();
      expect(found?.audience).toBe(expected.audience);
      expect(found?.modality).toBe(expected.modality);
      expect(found?.name).toContain(expected.nameIncludes);
    },
  );

  it("marks Quarta 19:45 as NOGI and Segunda/Sexta 19:45 as GI", () => {
    expect(isNogi(findScheduleSlot(rows, 3, "19:45")!)).toBe(true);
    expect(isNogi(findScheduleSlot(rows, 1, "19:45")!)).toBe(false);
    expect(isNogi(findScheduleSlot(rows, 5, "19:45")!)).toBe(false);
  });

  it("marks Quinta 10:00 as NOGI and Terça/Sexta 10:00 as GI", () => {
    expect(isNogi(findScheduleSlot(rows, 4, "10:00")!)).toBe(true);
    expect(isNogi(findScheduleSlot(rows, 2, "10:00")!)).toBe(false);
    expect(isNogi(findScheduleSlot(rows, 5, "10:00")!)).toBe(false);
  });

  it("filters by audience and modality", () => {
    expect(filterClassSchedules(rows, { audience: "infantil" })).toHaveLength(6);
    expect(filterClassSchedules(rows, { modality: "nogi" })).toHaveLength(2);
    expect(filterClassSchedules(rows, { audience: "feminino" })).toHaveLength(2);
    expect(filterClassSchedules(rows, { audience: "infantil", modality: "nogi" })).toHaveLength(0);
  });

  it("distinguishes filter misses from a catalog with no active slots", () => {
    const infantilNogi = filterClassSchedules(rows, { audience: "infantil", modality: "nogi" });
    expect(
      classScheduleEmptyMessage({
        rowCount: rows.length,
        filteredCount: infantilNogi.length,
        audience: "infantil",
        modality: "nogi",
      }),
    ).toBe(CLASS_SCHEDULE_FILTER_EMPTY);
    expect(
      classScheduleEmptyMessage({
        rowCount: 0,
        filteredCount: 0,
        audience: "all",
        modality: "all",
      }),
    ).toBe(CLASS_SCHEDULE_IDLE_EMPTY);
  });

  it("hides official_v1 from the board without dropping it on save", () => {
    expect(displayClassNotes("official_v1")).toBe("");
    expect(displayClassNotes("Turma experimental")).toBe("Turma experimental");
    expect(persistClassNotes("official_v1", "")).toBe("official_v1");
    expect(persistClassNotes("official_v1", "Observação do professor")).toBe("Observação do professor");
  });

  it("groups by weekday with sorted times", () => {
    const groups = groupClassSchedulesByDay(rows);
    expect(groups.map((g) => g.day)).toEqual([1, 2, 3, 4, 5]);
    const quarta = groups.find((g) => g.day === 3)!;
    expect(quarta.items.map((i) => formatStartTime(i.start_time))).toEqual([
      "17:40",
      "18:45",
      "19:45",
      "21:15",
    ]);
  });
});
