import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const WORKFLOW = ".github/workflows/database-backup.yml";
const SCRIPT = "scripts/backup-production-encrypted.sh";

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function activeYaml(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("Database encrypted backup workflow", () => {
  it("schedules a daily off-peak job without pushing dumps to git or artifacts", () => {
    const cron = read(WORKFLOW);
    const active = activeYaml(cron);
    expect(cron).toContain("name: Database encrypted backup");
    expect(active).toContain('cron: "17 3 * * *"');
    expect((active.match(/^\s+- cron:/gm) ?? []).length).toBe(1);
    expect(active).not.toMatch(/^\s*push:/m);
    expect(active).not.toMatch(/^\s*pull_request:/m);
    expect(cron).toContain("permissions:");
    expect(cron).toContain("contents: read");
    expect(cron).not.toContain("upload-artifact");
    expect(cron).not.toContain("actions/upload-artifact");
    expect(cron).not.toMatch(/git\s+push/);
    expect(cron).not.toContain("github.token");
    expect(cron).toContain("if: github.event_name == 'workflow_dispatch'");
  });

  it("encrypts with age and takes credentials only from Actions secrets", () => {
    const cron = read(WORKFLOW);
    expect(cron).toContain("secrets.BACKUP_DB_PASSWORD");
    expect(cron).toContain("secrets.BACKUP_AGE_RECIPIENT");
    expect(cron).toContain("secrets.BACKUP_DRIVE_TOKEN");
    expect(cron).toContain("secrets.BACKUP_S3_ENDPOINT");
    expect(cron).toContain("secrets.BACKUP_S3_BUCKET");
    expect(cron).toContain("secrets.BACKUP_S3_ACCESS_KEY_ID");
    expect(cron).toContain("secrets.BACKUP_S3_SECRET_ACCESS_KEY");
    expect(cron).toContain("scripts/backup-production-encrypted.sh");
    expect(cron).not.toMatch(/BACKUP_DB_PASSWORD:\s+[A-Za-z0-9]/);
    expect(cron).not.toMatch(/age1[a-z0-9]{20,}/);
  });

  it("keeps Production-only dump, shreds temps, and refuses staging", () => {
    const script = read(SCRIPT);
    expect(script).toContain("wojqjxtaqjasnfhbotxi");
    expect(script).toContain("apbksfaztfkxshxffpik");
    expect(script).toContain("recusando staging");
    expect(script).toContain("pg_dump");
    expect(script).toContain("postgres:17");
    expect(script).toContain("age -r");
    expect(script).toContain("age-encryption.org/v1");
    expect(script).toContain("shred");
    expect(script).toContain("rclone copy");
    expect(script).not.toContain("upload-artifact");
    expect(script).not.toContain("git push");
    expect(script).toContain("PGSSLMODE=require");
    expect(script).toContain("default_transaction_read_only=on");
    expect(script).toContain("--no-password");
    expect(script).toContain("--entrypoint pg_dump");
    expect(script).toContain("rclone copyto");
    expect(script).toContain("BACKUP_DEST");
    expect(script).toContain("drive.file");
    expect(script).toContain("FaithBrothers_Backups");
    expect(script).toContain("destino GitHub recusado");
    expect(script).toContain("--schema=public");
    expect(script).toContain("connect_ok");
    expect(script).toContain("--preflight");
    expect(script).toContain("--env-file");
    expect(script).not.toMatch(/-e ["']PGPASSWORD=/);
  });
});
