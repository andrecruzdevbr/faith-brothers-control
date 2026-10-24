import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const WORKFLOW = ".github/workflows/birthday-cron.yml";

function readWorkflow(): string {
  return readFileSync(resolve(ROOT, WORKFLOW), "utf8");
}

function activeYaml(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("Birthday cron workflow", () => {
  it("keeps the daily 11:00 UTC schedule and does not change other jobs", () => {
    const cron = readWorkflow();
    const active = activeYaml(cron);
    expect(cron).toContain("name: Birthday cron");
    expect(active).toContain('cron: "0 11 * * *"');
    expect(active).toContain("/send-birthday-whatsapp");
    expect(cron).not.toContain("generate-monthly-billings");
    expect(cron).not.toContain("process-whatsapp-queue");
  });

  it("refuses staging and requires Production wojqjxtaqjasnfhbotxi", () => {
    const cron = readWorkflow();
    expect(cron).toContain("wojqjxtaqjasnfhbotxi");
    expect(cron).toContain("apbksfaztfkxshxffpik");
    expect(cron).toContain("Recusando: BASE_URL aponta ao staging");
    expect(cron).toContain("Recusando: BASE_URL nao aponta a Production");
    expect(cron).not.toMatch(/functions\/v1\/.*apbksfaztfkxshxffpik/);
  });
});
