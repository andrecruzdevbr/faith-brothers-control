/** Official class schedule helpers — single UI source of truth over DB rows. */

export type ClassAudience = "infantil" | "adulto" | "feminino";
export type ClassLevel = "iniciante" | "avancado" | "iniciante_avancado";
export type ClassModality = "gi" | "nogi";

export type ClassScheduleRow = {
  id: string;
  academy_id: string;
  name: string;
  day_of_week: number;
  start_time: string;
  audience: ClassAudience | string;
  level: ClassLevel | string | null;
  modality: ClassModality | string;
  notes?: string | null;
  sort_order?: number | null;
  active?: boolean | null;
  schedule_days?: string | null;
  schedule_time?: string | null;
};

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
  7: "Domingo",
};

export const WEEKDAY_LABELS_LONG: Record<number, string> = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
  7: "Domingo",
};

export const AUDIENCE_LABELS: Record<ClassAudience, string> = {
  infantil: "Infantil",
  adulto: "Adulto",
  feminino: "Feminino",
};

export const LEVEL_LABELS: Record<ClassLevel, string> = {
  iniciante: "iniciante",
  avancado: "avançado",
  iniciante_avancado: "iniciante/avançado",
};

export const MODALITY_LABELS: Record<ClassModality, string> = {
  gi: "GI — Com kimono",
  nogi: "NOGI — Sem kimono",
};

export function formatStartTime(value: string | null | undefined): string {
  if (!value) return "";
  // Postgres time may come as HH:MM:SS
  return String(value).slice(0, 5);
}

const TECHNICAL_CLASS_NOTES = new Set(["official_v1"]);

/** Hide internal catalog markers from the class board while keeping them in the database. */
export function displayClassNotes(notes: string | null | undefined): string {
  const value = (notes ?? "").trim();
  if (!value) return "";
  if (TECHNICAL_CLASS_NOTES.has(value)) return "";
  return value;
}

/** Keep technical markers when the operator did not type a replacement note. */
export function persistClassNotes(
  original: string | null | undefined,
  edited: string | null | undefined,
): string | null {
  const next = (edited ?? "").trim();
  if (next) return next;
  const raw = (original ?? "").trim();
  if (TECHNICAL_CLASS_NOTES.has(raw)) return raw;
  return null;
}

export function formatClassTitle(row: Pick<ClassScheduleRow, "name" | "audience" | "level">): string {
  const name = (row.name ?? "").trim();
  if (name) return name;
  const audience = AUDIENCE_LABELS[(row.audience as ClassAudience) ?? "adulto"] ?? row.audience;
  if (row.level === "iniciante_avancado") return `${audience} iniciante/avançado`;
  if (row.level && LEVEL_LABELS[row.level as ClassLevel]) {
    return `${audience} ${LEVEL_LABELS[row.level as ClassLevel]}`;
  }
  return String(audience);
}

export function isNogi(row: Pick<ClassScheduleRow, "modality">): boolean {
  return String(row.modality).toLowerCase() === "nogi";
}

export function filterClassSchedules(
  rows: ClassScheduleRow[],
  filters: { audience?: string | null; modality?: string | null },
): ClassScheduleRow[] {
  return rows.filter((row) => {
    if (filters.audience && filters.audience !== "all" && row.audience !== filters.audience) {
      return false;
    }
    if (filters.modality && filters.modality !== "all" && row.modality !== filters.modality) {
      return false;
    }
    return true;
  });
}

export function groupClassSchedulesByDay(
  rows: ClassScheduleRow[],
): Array<{ day: number; label: string; labelLong: string; items: ClassScheduleRow[] }> {
  const map = new Map<number, ClassScheduleRow[]>();
  for (const row of rows) {
    const day = Number(row.day_of_week);
    if (!Number.isFinite(day)) continue;
    const list = map.get(day) ?? [];
    list.push(row);
    map.set(day, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, items]) => ({
      day,
      label: WEEKDAY_LABELS[day] ?? `Dia ${day}`,
      labelLong: WEEKDAY_LABELS_LONG[day] ?? WEEKDAY_LABELS[day] ?? `Dia ${day}`,
      items: [...items].sort((a, b) => {
        const ta = formatStartTime(a.start_time);
        const tb = formatStartTime(b.start_time);
        if (ta !== tb) return ta.localeCompare(tb);
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      }),
    }));
}

/** Expected official slots for unit tests (day, HH:MM, audience, modality). */
export const OFFICIAL_SCHEDULE_EXPECTATIONS: Array<{
  day: number;
  time: string;
  audience: ClassAudience;
  modality: ClassModality;
  nameIncludes: string;
}> = [
  { day: 1, time: "17:40", audience: "infantil", modality: "gi", nameIncludes: "Infantil" },
  { day: 3, time: "17:40", audience: "infantil", modality: "gi", nameIncludes: "Infantil" },
  { day: 5, time: "17:40", audience: "infantil", modality: "gi", nameIncludes: "Infantil" },
  { day: 1, time: "18:45", audience: "infantil", modality: "gi", nameIncludes: "Infantil" },
  { day: 3, time: "18:45", audience: "infantil", modality: "gi", nameIncludes: "Infantil" },
  { day: 5, time: "18:45", audience: "infantil", modality: "gi", nameIncludes: "Infantil" },
  { day: 1, time: "19:45", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 3, time: "19:45", audience: "adulto", modality: "nogi", nameIncludes: "Adulto" },
  { day: 5, time: "19:45", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 1, time: "21:15", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 3, time: "21:15", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 5, time: "21:15", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 2, time: "10:00", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 4, time: "10:00", audience: "adulto", modality: "nogi", nameIncludes: "Adulto" },
  { day: 5, time: "10:00", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 2, time: "13:30", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 4, time: "13:30", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 2, time: "17:00", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 4, time: "17:00", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 2, time: "18:00", audience: "feminino", modality: "gi", nameIncludes: "Feminino" },
  { day: 4, time: "18:00", audience: "feminino", modality: "gi", nameIncludes: "Feminino" },
  { day: 2, time: "19:00", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
  { day: 4, time: "19:00", audience: "adulto", modality: "gi", nameIncludes: "Adulto" },
];

export function findScheduleSlot(
  rows: ClassScheduleRow[],
  day: number,
  time: string,
): ClassScheduleRow | undefined {
  const want = time.slice(0, 5);
  return rows.find(
    (r) => Number(r.day_of_week) === day && formatStartTime(r.start_time) === want,
  );
}
