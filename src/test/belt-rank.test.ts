import { describe, expect, it } from "vitest";
import { BELTS } from "@/lib/constants";
import { buildBeltDistribution, compareStudentsByOfficialBelt, officialBeltIndex } from "@/lib/belt-rank";

describe("official belt order", () => {
  it("uses BELTS so kids ranks are not -1", () => {
    expect(officialBeltIndex("Cinza")).toBeGreaterThanOrEqual(0);
    expect(officialBeltIndex("Amarela")).toBeGreaterThan(officialBeltIndex("Branca"));
    expect(officialBeltIndex("Preta")).toBe(BELTS.length - 1);
    expect(officialBeltIndex("Faixa Inventada")).toBe(-1);
  });

  it("sorts Preta before kids belts, and unknown last", () => {
    const rows = [
      { belt: "Cinza", degrees: 0, name: "kid" },
      { belt: "Preta", degrees: 1, name: "black" },
      { belt: "Inexistente", degrees: 0, name: "unknown" },
      { belt: "Branca", degrees: 2, name: "white" },
    ];
    const sorted = [...rows].sort(compareStudentsByOfficialBelt);
    expect(sorted.map((row) => row.name)).toEqual(["black", "kid", "white", "unknown"]);
  });
});

describe("belt distribution from the full eligible set", () => {
  it("returns empty for 0 students", () => {
    expect(buildBeltDistribution([])).toEqual([]);
  });

  it("counts a single student", () => {
    expect(buildBeltDistribution([{ belt: "Azul" }])).toEqual([{ name: "Azul", value: 1 }]);
  });

  it("does not truncate at 20 when there are 21 students", () => {
    const students = Array.from({ length: 21 }, (_, i) => ({
      belt: i < 20 ? "Branca" : "Preta",
    }));
    expect(buildBeltDistribution(students)).toEqual([
      { name: "Branca", value: 20 },
      { name: "Preta", value: 1 },
    ]);
  });

  it("counts more than 100 students without dropping belts", () => {
    const students = [
      ...Array.from({ length: 80 }, () => ({ belt: "Branca" as const })),
      ...Array.from({ length: 25 }, () => ({ belt: "Cinza" as const })),
      ...Array.from({ length: 12 }, () => ({ belt: "Preta" as const })),
    ];
    expect(buildBeltDistribution(students)).toEqual([
      { name: "Branca", value: 80 },
      { name: "Cinza", value: 25 },
      { name: "Preta", value: 12 },
    ]);
    expect(students).toHaveLength(117);
  });
});
