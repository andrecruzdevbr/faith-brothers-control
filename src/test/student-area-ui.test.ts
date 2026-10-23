import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("student area visual fixes", () => {
  it("lets graduation names wrap instead of truncating", () => {
    const source = read("src/pages/MinhaGraduacao.tsx");
    expect(source).toContain("break-words");
    expect(source).not.toMatch(/full_name\} \{isMe && "\(Você\)"/);
    expect(source).not.toMatch(/className=\{`text-sm font-medium truncate/);
  });

  it("does not repeat the turmas heading on the student schedule page", () => {
    const page = read("src/pages/MinhasTurmas.tsx");
    expect(page).toContain("title={null}");
    expect(page.match(/TURMAS E HORÁRIOS/g)?.length).toBeLessThanOrEqual(2);
  });

  it("gives the plan-change dialog a title and description", () => {
    const source = read("src/pages/MeuFinanceiro.tsx");
    expect(source).toContain("DialogTitle");
    expect(source).toContain("DialogDescription");
    expect(source).toContain("Solicitar mudança de plano");
  });

  it("labels the mobile navigation sheet for screen readers", () => {
    const source = read("src/components/ui/sidebar.tsx");
    expect(source).toContain("SheetTitle");
    expect(source).toContain("Menu de navegação");
  });
});
