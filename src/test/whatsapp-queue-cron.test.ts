import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const WORKFLOW = ".github/workflows/whatsapp-queue-cron.yml";

function readWorkflow(): string {
  return readFileSync(resolve(ROOT, WORKFLOW), "utf8");
}

function activeYaml(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("WhatsApp Queue cron workflow", () => {
  it("is a dedicated five-minute schedule without other executable triggers", () => {
    const cron = readWorkflow();
    const active = activeYaml(cron);
    expect(cron).toContain("name: WhatsApp Queue cron");
    expect(active).toContain('cron: "*/5 * * * *"');
    expect(active).toMatch(/^\s*schedule:/m);
    expect(active).not.toMatch(/^on:\s*\{\s*\}/m);
    expect(active).not.toMatch(/\bworkflow_dispatch\b/);
    expect(active).not.toMatch(/\brepository_dispatch\b/);
    expect(active).not.toMatch(/^\s*push:/m);
    expect(active).not.toMatch(/^\s*pull_request:/m);
    expect(cron).toContain("concurrency:");
    expect(cron).toContain("group: whatsapp-queue-cron");
    expect(cron).toContain("cancel-in-progress: false");
    expect(cron).toContain("timeout-minutes: 2");
  });

  it("posts only to Production process-whatsapp-queue with the shared cron secret", () => {
    const cron = readWorkflow();
    expect(cron).toContain("secrets.SUPABASE_FUNCTIONS_BASE_URL");
    expect(cron).toContain("secrets.BILLING_CRON_SECRET");
    expect(cron).toContain("x-cron-secret:");
    expect(cron).toContain("-X POST");
    expect(cron).toContain("/process-whatsapp-queue");
    expect(cron).toContain("wojqjxtaqjasnfhbotxi");
    expect(cron).toContain("Recusando: BASE_URL aponta ao staging");
    expect(cron).toContain("apbksfaztfkxshxffpik");
    expect(cron).toContain("curl -fsS --max-time 45");
    expect(cron).toContain("set -euo pipefail");
    expect(cron).not.toMatch(/functions\/v1\/.*apbksfaztfkxshxffpik/);
  });

  it("does not force sends or embed secret values", () => {
    const cron = readWorkflow();
    const active = activeYaml(cron);
    expect(cron).not.toContain("sendWhatsApp");
    expect(cron).not.toContain("force");
    expect(active).not.toContain("workflow_dispatch");
    expect(cron).not.toMatch(/x-cron-secret:\s+[A-Za-z0-9_-]{8,}/);
    expect(cron).not.toMatch(/BILLING_CRON_SECRET=[^\n{]/);
    expect(cron).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(cron).toContain("-d '{}'");
    expect(cron).not.toContain("generate-monthly-billings");
    expect(cron).not.toContain("send-birthday-whatsapp");
  });
});
