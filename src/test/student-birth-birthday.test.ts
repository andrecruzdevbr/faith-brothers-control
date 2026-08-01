import { describe, expect, it, vi } from "vitest";
import {
  formatAgeDisplay,
  formatBirthDateDisplay,
  getAgeYears,
  isMinor,
  validateStudentBirthFields,
} from "@/lib/student-age";
import { buildBirthdayMessage } from "../../supabase/functions/_shared/whatsapp-messages.ts";
import { runBirthdayWhatsAppJob } from "../../supabase/functions/_shared/birthday-whatsapp.ts";
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

describe("birthday WhatsApp automation", () => {
  it("builds birthday message with first name", () => {
    const msg = buildBirthdayMessage("João Silva", "Faith Brothers BJJ");
    expect(msg).toContain("Parabéns, João!");
    expect(msg).toContain("Faith Brothers BJJ");
    expect(msg).toContain("Oss!");
  });

  it("queues birthday for active student once and skips duplicate year", async () => {
    const queueWhatsAppFn = vi.fn(async () => ({
      messageId: "msg-bday-1",
      sent: false,
      skipped: true,
      reason: "WHATSAPP_SEND_ENABLED=false",
    }));

    let birthdayInsertCount = 0;
    const supabase = {
      from(table: string) {
        if (table === "students") {
          return {
            select() {
              return {
                eq() {
                  return {
                    not() {
                      return Promise.resolve({
                        data: [
                          {
                            id: "st-1",
                            academy_id: "ac-1",
                            full_name: "Ana Souza",
                            whatsapp: "31999999999",
                            birth_date: "2000-08-01",
                            status: "ativo",
                            academies: { name: "Faith Brothers BJJ" },
                          },
                          {
                            id: "st-4",
                            academy_id: "ac-1",
                            full_name: "Sem Zap",
                            whatsapp: "123",
                            birth_date: "2000-08-01",
                            status: "ativo",
                          },
                        ],
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "birthday_messages") {
          return {
            insert() {
              birthdayInsertCount += 1;
              if (birthdayInsertCount === 1) {
                return {
                  select() {
                    return {
                      maybeSingle() {
                        return Promise.resolve({ data: { id: "bm-1" }, error: null });
                      },
                    };
                  },
                };
              }
              return {
                select() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({
                        data: null,
                        error: { code: "23505", message: "duplicate key" },
                      });
                    },
                  };
                },
              };
            },
            update() {
              return {
                eq() {
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const first = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
    });

    expect(first.found).toBe(2); // Ana + Sem Zap (mesmo dia; query já filtra ativo + birth_date)
    expect(first.queued).toBe(1);
    expect(first.skipped_invalid_whatsapp).toBe(1);
    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
    expect(queueWhatsAppFn.mock.calls[0][0].messageType).toBe("birthday");

    const second = await runBirthdayWhatsAppJob({
      supabase: supabase as never,
      now: new Date("2026-08-01T15:00:00Z"),
      queueWhatsAppFn,
    });
    expect(second.skipped_duplicate).toBe(1);
    expect(second.queued).toBe(0);
    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
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
