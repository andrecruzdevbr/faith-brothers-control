import { BELTS } from "@/lib/constants";

export function officialBeltIndex(belt: string | null | undefined): number {
  const name = belt || "Branca";
  return (BELTS as readonly string[]).indexOf(name);
}

/** Higher official rank first (Preta before Branca). Unknown belts after Branca. */
export function compareStudentsByOfficialBelt<T extends { belt: string | null; degrees?: number | null }>(
  a: T,
  b: T,
): number {
  const beltDelta = officialBeltIndex(b.belt) - officialBeltIndex(a.belt);
  if (beltDelta !== 0) return beltDelta;
  return (b.degrees || 0) - (a.degrees || 0);
}

export function buildBeltDistribution(students: Array<{ belt: string | null | undefined }>): Array<{
  name: string;
  value: number;
}> {
  const counts = new Map<string, number>();
  for (const student of students) {
    const belt = student.belt || "Branca";
    counts.set(belt, (counts.get(belt) ?? 0) + 1);
  }

  const ordered: Array<{ name: string; value: number }> = [];
  for (const belt of BELTS) {
    const value = counts.get(belt) ?? 0;
    if (value > 0) ordered.push({ name: belt, value });
    counts.delete(belt);
  }
  for (const [name, value] of counts) {
    if (value > 0) ordered.push({ name, value });
  }
  return ordered;
}
