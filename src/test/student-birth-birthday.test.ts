import { describe, expect, it, vi } from "vitest";
import {
  formatAgeDisplay,
  formatBirthDateDisplay,
  getAgeYears,
  isMinor,
  validateStudentBirthFields,
} from "@/lib/student-age";
import { buildBirthdayMessage } from "../../supabase/functions/_shared/whatsapp-messages.ts";
import {
  buildBirthdayIdempotencyKey,
  resolveBirthdayYearAction,
  runBirthdayWhatsAppJob,
} from "../../supabase/functions/_shared/birthday-whatsapp.ts";
import { WHATSAPP_RECIPIENT_NOT_ALLOWED } from "../../supabase/functions/_shared/whatsapp-allowlist.ts";
import { canAccessPath, isAcademyLimitedRole } from "@/lib/access";

describe("student birth / guardian validation", () => {
  const today = "2026-08-01";

  it("requires birth_date", () => {
    expect(validateStudentBirthFields({ birthDate: "", guardianName: "" })).toBe(
      "Informe a data de nascimento.",
    );
  });

  it("rejects future birth_date", () => {
    expect(
      validateStudentBirthFields({ birthDate: "2026-08-02", guardianName: "", today }),
    ).toBe("A data de nascimento não pode ser futura.");
  });

  it("rejects age over 100", () => {
    expect(
      validateStudentBirthFields({ birthDate: "1920-01-01", guardianName: "", today }),
    ).toBe("Confira a data de nascimento informada.");
  });

  it("allows adult without guardian", () => {
    expect(
      validateStudentBirthFields({ birthDate: "1990-05-10", guardianName: "", today }),
    ).toBeNull();
  });

  it("requires guardian for minor", () => {
    expect(
      validateStudentBirthFields({ birthDate: "2015-05-10", guardianName: "", today }),
    ).toBe("Informe o nome do responsável para alunos menores de idade.");
  });

  it("allows minor with guardian", () => {
    expect(
      validateStudentBirthFields({
        birthDate: "2015-05-10",
        guardianName: "Maria Responsável",
        today,
      }),
    ).toBeNull();
  });

  it("computes age and minor flag", () => {
    expect(getAgeYears("2008-08-01", today)).toBe(18);
    expect(isMinor("2008-08-02", today)).toBe(true);
    expect(isMinor("2008-08-01", today)).toBe(false);
  });

  it("displays missing birth_date safely for legacy students", () => {
    expect(formatBirthDateDisplay(null)).toBe("Não informada");
    expect(formatAgeDisplay(null)).toBe("—");
  });
});

describe("birthday year claim", () => {
  it("uses Brasília civil year in the idempotency key", () => {
    expect(buildBirthdayIdempotencyKey("st-1", 2026)).toBe("birthday:st-1:2026");
  });

  it("retries failed claims and keeps sent/queued as unique for the year", () => {
    expect(resolveBirthdayYearAction(null)).toBe("insert");
    expect(resolveBirthdayYearAction({ status: "sent" })).toBe("skip_delivered");
    expect(resolveBirthdayYearAction({ status: "queued" })).toBe("skip_queued");
    expect(resolveBirthdayYearAction({ status: "failed" })).toBe("retry_failed");
  });
});

type BirthdayStoreRow = {
  id: string;
  student_id: string;
  academy_id: string;
  birthday_year: number;
  status: string;
  error_message?: string | null;
};

function createBirthdayHarness(students: Array<Record<string, unknown>>) {
  const store = new Map<string, BirthdayStoreRow>();
  let insertSeq = 0;
  const supabase = {
    from(table: string) {
      if (table === "students") {
        return {
          select() {
            return {
              eq() {
                return {
                  not() {
                    return Promise.resolve({ data: students, error: null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "birthday_messages") {
        return {
          select() {
            return {
              eq(_col: string, val: string | number) {
                return {
                  eq(_col2: string, val2: string | number) {
                    const studentId = String(_col === "student_id" ? val : val2);
                    const year = Number(_col === "birthday_year" ? val : val2);
                    return {
                      maybeSingle() {
                        return Promise.resolve({
                          data: store.get(`${studentId}:${year}`) ?? null,
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
          insert(payload: Omit<BirthdayStoreRow, "id">) {
            const key = `${payload.student_id}:${payload.birthday_year}`;
            if (store.has(key)) {
              const dup = {
                data: null,
                error: { code: "23505", message: "duplicate key" },
              };
              return {
                select() {
                  return { maybeSingle() { return Promise.resolve(dup); } };
                },
                then(resolve: (v: unknown) => unknown) {
                  return Promise.resolve(dup).then(resolve);
                },
              };
            }
            insertSeq += 1;
            const row = { ...payload, id: `bm-${insertSeq}` };
            store.set(key, row);
            const ok = { data: { id: row.id }, error: null };
            return {
              select() {
                return { maybeSingle() { return Promise.resolve(ok); } };
              },
              then(resolve: (v: unknown) => unknown) {
                return Promise.resolve(ok).then(resolve);
              },
            };
          },
          update(payload: Partial<BirthdayStoreRow>) {
            return {
              eq(_col: string, id: string) {
                for (const [key, row] of store) {
                  if (row.id === id) store.set(key, { ...row, ...payload });
                }
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase, store };
}

const ANA = {
  id: "st-1",
  academy_id: "ac-1",
  full_name: "Ana Souza",
  whatsapp: "31999999999",
  birth_date: "2000-08-01",
  status: "ativo",
  academies: { name: "Faith Brothers BJJ" },
};
const SEM_ZAP = {
  id: "st-4",
  academy_id: "ac-1",
  full_name: "Sem Zap",
  whatsapp: "123",
  birth_date: "2000-08-01",
  status: "ativo",
};

describe("birthday WhatsApp automation", () => {
  it("builds birthday message with first name", () => {
    const msg = buildBirthdayMessage("João Silva", "Faith Brothers BJJ");
    expect(msg).toContain("Parabéns, João!");
    expect(msg).toContain("Faith Brothers BJJ");
    expect(msg).toContain("Osss!");
  });

  it("queues birthday for active student once and skips duplicate year", async () => {
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; idempotencyKey?: string }) => ({
      messageId: "msg-bday-1",
      sent: false,
      skipped: true,
      reason: "WHATSAPP_SEND_ENABLED=false",
    }));
    const { supabase } = createBirthdayHarness([ANA, SEM_ZAP]);

    const first = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
    });

    expect(first.year).toBe(2026);
    expect(first.date).toBe("2026-08-01");
    expect(first.found).toBe(2);
    expect(first.queued).toBe(1);
    expect(first.skipped_invalid_whatsapp).toBe(1);
    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
    expect(queueWhatsAppFn.mock.calls[0][0].messageType).toBe("birthday");
    expect(queueWhatsAppFn.mock.calls[0][0].idempotencyKey).toBe("birthday:st-1:2026");

    const second = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
    });
    expect(second.skipped_duplicate).toBe(1);
    expect(second.queued).toBe(0);
    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
  });

  it("does not treat allowlist blocks as delivered and retries later", async () => {
    const queueWhatsAppFn = vi.fn(async () => ({
      messageId: "msg-bday-2",
      sent: true,
    }));
    const { supabase, store } = createBirthdayHarness([ANA]);
    const homolog = ["5531981044156"];

    const blocked = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
      allowedRecipients: homolog,
    });
    expect(blocked.skipped_allowlist).toBe(1);
    expect(blocked.queued).toBe(0);
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
    expect(store.get("st-1:2026")?.status).toBe("failed");
    expect(store.get("st-1:2026")?.error_message).toBe(WHATSAPP_RECIPIENT_NOT_ALLOWED);

    const stillBlocked = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
      allowedRecipients: homolog,
    });
    expect(stillBlocked.skipped_allowlist).toBe(1);
    expect(queueWhatsAppFn).not.toHaveBeenCalled();

    const released = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
      allowedRecipients: null,
    });
    expect(released.queued).toBe(1);
    expect(released.skipped_allowlist).toBe(0);
    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
    expect(store.get("st-1:2026")?.status).toBe("sent");
  });

  it("records send failures as failed so the year can be retried", async () => {
    const queueWhatsAppFn = vi.fn(async (): Promise<{ messageId: string; sent: boolean }> => {
      throw new Error("Evolution API timeout");
    });
    const { supabase, store } = createBirthdayHarness([ANA]);
    const failed = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
    });
    expect(failed.failed).toBe(1);
    expect(store.get("st-1:2026")?.status).toBe("failed");

    queueWhatsAppFn.mockImplementationOnce(async () => ({ messageId: "msg-ok", sent: true }));
    const retried = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
    });
    expect(retried.queued).toBe(1);
    expect(store.get("st-1:2026")?.status).toBe("sent");
  });
});

describe("academy_limited still blocked from Alunos", () => {
  it("keeps limited out of alunos/financeiro", () => {
    const limited = ["academy_limited"] as const;
    expect(isAcademyLimitedRole([...limited])).toBe(true);
    expect(canAccessPath([...limited], "/alunos")).toBe(false);
    expect(canAccessPath([...limited], "/financeiro")).toBe(false);
  });
});
