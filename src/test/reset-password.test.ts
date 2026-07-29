import { describe, it, expect, vi } from "vitest";
import {
  handleRequestOtp,
  OTP_EXPIRY_MINUTES,
  PASSWORD_RESET_GENERIC_MESSAGE,
} from "../../supabase/functions/_shared/password-reset.ts";
import { buildPasswordResetOtpMessage } from "../../supabase/functions/_shared/whatsapp-messages.ts";

const OTP_CODE = "654321";

function createResetSupabaseMock(options: {
  userEmail?: string | null;
  rateLimitRow?: Record<string, unknown> | null;
}) {
  const otpDeleteEq = vi.fn(async () => ({ data: null, error: null }));
  const otpInsert = vi.fn(async () => ({ data: null, error: null }));
  const rateUpsert = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "otp_rate_limits") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: options.rateLimitRow ?? null,
                error: null,
              })),
            })),
          })),
          upsert: rateUpsert,
        };
      }

      if (table === "otp_tokens") {
        return {
          delete: vi.fn(() => ({ eq: otpDeleteEq })),
          insert: otpInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: {
            users: options.userEmail
              ? [{ id: "user-1", email: options.userEmail }]
              : [],
          },
          error: null,
        })),
      },
    },
  };

  return { supabase, otpInsert, otpDeleteEq, rateUpsert };
}

describe("password reset OTP WhatsApp", () => {
  it("builds OTP message without leaking formatting issues", () => {
    const message = buildPasswordResetOtpMessage(OTP_CODE, OTP_EXPIRY_MINUTES);
    expect(message).toContain(`*${OTP_CODE}*`);
    expect(message).toContain(`${OTP_EXPIRY_MINUTES} minutos`);
    expect(message).toContain("Faith Brothers Control");
  });

  it("requests code and queues WhatsApp with OTP body", async () => {
    const { supabase, otpInsert } = createResetSupabaseMock({
      userEmail: "31985010010@wa.faithbrothers.app",
    });

    const queueWhatsAppFn = vi.fn(async (params) => {
      expect(params.body).toContain(OTP_CODE);
      expect(params.messageType).toBe("otp");
      return { messageId: "msg-otp", sent: true };
    });

    const result = await handleRequestOtp({
      supabase: supabase as never,
      whatsappRaw: "31985010010",
      queueWhatsAppFn,
      createOtpCode: () => OTP_CODE,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.message).toBe(PASSWORD_RESET_GENERIC_MESSAGE);
    expect(result.body.whatsapp).toEqual({ queued: true, skipped: false, reason: undefined });
    expect(JSON.stringify(result.body)).not.toContain(OTP_CODE);
    expect(otpInsert).toHaveBeenCalledOnce();
    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
  });

  it("respects WHATSAPP_SEND_ENABLED=false via skipped queue result", async () => {
    const { supabase } = createResetSupabaseMock({
      userEmail: "31985010010@wa.faithbrothers.app",
    });

    const queueWhatsAppFn = vi.fn(async () => ({
      messageId: "msg-otp",
      sent: false,
      skipped: true,
      reason: "WHATSAPP_SEND_ENABLED=false",
    }));

    const result = await handleRequestOtp({
      supabase: supabase as never,
      whatsappRaw: "31985010010",
      queueWhatsAppFn,
      createOtpCode: () => OTP_CODE,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.whatsapp).toEqual({
      queued: true,
      skipped: true,
      reason: "WHATSAPP_SEND_ENABLED=false",
    });
    expect(JSON.stringify(result.body)).not.toContain(OTP_CODE);
  });

  it("does not expose OTP or secrets when WhatsApp send fails", async () => {
    const { supabase } = createResetSupabaseMock({
      userEmail: "31985010010@wa.faithbrothers.app",
    });

    const queueWhatsAppFn = vi.fn(async () => {
      throw new Error("apikey=secret-should-not-leak Evolution failed");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handleRequestOtp({
      supabase: supabase as never,
      whatsappRaw: "31985010010",
      queueWhatsAppFn,
      createOtpCode: () => OTP_CODE,
    });

    const logged = errorSpy.mock.calls.map((args) => JSON.stringify(args)).join("\n");
    errorSpy.mockRestore();

    expect(result.status).toBe(502);
    expect(result.body.error).toBe("Falha ao enviar código via WhatsApp");
    expect(JSON.stringify(result.body)).not.toContain(OTP_CODE);
    expect(JSON.stringify(result.body)).not.toContain("secret-should-not-leak");
    expect(JSON.stringify(result.body)).not.toContain("apikey=");
    expect(logged).not.toContain("secret-should-not-leak");
    expect(logged).toContain("[REDACTED]");
  });

  it("returns generic success without OTP when WhatsApp is not registered", async () => {
    const { supabase, otpInsert } = createResetSupabaseMock({
      userEmail: null,
    });

    const queueWhatsAppFn = vi.fn();

    const result = await handleRequestOtp({
      supabase: supabase as never,
      whatsappRaw: "31985010010",
      queueWhatsAppFn,
      createOtpCode: () => OTP_CODE,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe(PASSWORD_RESET_GENERIC_MESSAGE);
    expect(result.body.whatsapp).toEqual({ queued: false });
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
    expect(otpInsert).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain(OTP_CODE);
  });
});
