import { describe, it, expect, vi } from "vitest";
import { mapRegisterStudentRpcError } from "../../supabase/functions/_shared/register-errors.ts";
import { buildRegistrationReceivedMessage } from "../../supabase/functions/_shared/whatsapp-messages.ts";
import { dispatchRegistrationWhatsApp } from "../../supabase/functions/_shared/registration-whatsapp.ts";

describe("mapRegisterStudentRpcError", () => {
  it("maps duplicate CPF/CNPJ before WhatsApp", () => {
    expect(mapRegisterStudentRpcError("Este CPF/CNPJ já está cadastrado.")).toEqual({
      status: 409,
      error: "Este CPF/CNPJ já está cadastrado.",
    });
    expect(mapRegisterStudentRpcError("Este CPF/CNPJ já está cadastrado para outro aluno.")).toEqual({
      status: 409,
      error: "Este CPF/CNPJ já está cadastrado.",
    });
  });

  it("maps duplicate WhatsApp separately", () => {
    expect(mapRegisterStudentRpcError("Este WhatsApp já está cadastrado.")).toEqual({
      status: 409,
      error: "Este WhatsApp já está cadastrado.",
    });
  });

  it("does not map CPF duplicate as WhatsApp", () => {
    const result = mapRegisterStudentRpcError("Este CPF/CNPJ já está cadastrado.");
    expect(result.error).not.toContain("WhatsApp");
  });

  it("redacts document numbers from generic errors", () => {
    const result = mapRegisterStudentRpcError("Falha ao validar 52998224725 no serviço");
    expect(result.status).toBe(500);
    expect(result.error).not.toContain("52998224725");
    expect(result.error).toContain("[documento]");
  });
});

describe("register-student WhatsApp confirmation", () => {
  it("builds the expected confirmation message", () => {
    const message = buildRegistrationReceivedMessage("João Silva");
    expect(message).toContain("Olá, João Silva!");
    expect(message).toContain("Faith Brothers Control");
    expect(message).toContain("aguardar a aprovação da academia");
    expect(message).toContain("WhatsApp e senha cadastrada");
  });

  it("queues WhatsApp after successful registration path", async () => {
    const queueWhatsAppFn = vi.fn(async () => ({
      messageId: "msg-1",
      sent: false,
      skipped: true,
      reason: "WHATSAPP_SEND_ENABLED=false",
    }));

    const result = await dispatchRegistrationWhatsApp({
      supabase: {} as never,
      academyId: "academy-1",
      studentId: "student-1",
      fullName: "Maria Souza",
      whatsapp: "31985010010",
      queueWhatsAppFn,
    });

    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
    expect(queueWhatsAppFn.mock.calls[0][0].recipient).toBe("31985010010");
    expect(queueWhatsAppFn.mock.calls[0][0].body).toContain("Maria Souza");
    expect(result).toEqual({
      queued: true,
      skipped: true,
      reason: "WHATSAPP_SEND_ENABLED=false",
    });
  });

  it("does not break registration when WhatsApp queue fails", async () => {
    const queueWhatsAppFn = vi.fn(async () => {
      throw new Error("apikey=secret-should-not-leak Evolution down");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await dispatchRegistrationWhatsApp({
      supabase: {} as never,
      academyId: "academy-1",
      studentId: "student-1",
      fullName: "Pedro",
      whatsapp: "31999999999",
      queueWhatsAppFn,
    });

    const logged = errorSpy.mock.calls.map((args) => JSON.stringify(args)).join("\n");
    errorSpy.mockRestore();

    expect(result).toEqual({
      queued: false,
      reason: "whatsapp_queue_failed",
    });
    expect(logged).not.toContain("secret-should-not-leak");
    expect(logged).toContain("[REDACTED]");
  });
});
