import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_QR_TTL_MINUTES,
  ATTENDANCE_QR_TTL_MS,
  computeAttendanceQrExpiresAt,
  decideAttendanceQrCheckIn,
  deviceClockOffsetMs,
  formatAttendanceQrCountdown,
  isAttendanceQrExpired,
  remainingAttendanceQrMs,
  remainingAttendanceQrMsAgainstServer,
} from "@/lib/attendance-qr";

const ROOT = resolve(process.cwd());
const started = new Date("2026-10-22T20:00:00.000Z");
const expires = computeAttendanceQrExpiresAt(started);

const session = {
  token: "qr-token",
  expiresAt: expires.toISOString(),
  endedAt: null as string | null,
  academyId: "academy-1",
};

const student = { academyId: "academy-1", status: "ativo" };

describe("attendance QR TTL is 20 minutes", () => {
  it("uses a 20-minute lifetime", () => {
    expect(ATTENDANCE_QR_TTL_MINUTES).toBe(20);
    expect(ATTENDANCE_QR_TTL_MS).toBe(20 * 60 * 1000);
    expect(expires.toISOString()).toBe("2026-10-22T20:20:00.000Z");
  });
});

describe("attendance QR expiry window", () => {
  it("stays valid after 1 minute", () => {
    const now = new Date(started.getTime() + 60 * 1000);
    expect(isAttendanceQrExpired(expires, now)).toBe(false);
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student,
        alreadyCheckedInToday: false,
        serverNow: now.toISOString(),
      }),
    ).toEqual({ ok: true });
  });

  it("stays valid after 19 minutes and 59 seconds", () => {
    const now = new Date(started.getTime() + 19 * 60 * 1000 + 59 * 1000);
    expect(isAttendanceQrExpired(expires, now)).toBe(false);
    expect(remainingAttendanceQrMs(expires, now)).toBe(1000);
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student,
        alreadyCheckedInToday: false,
        serverNow: now.toISOString(),
      }).ok,
    ).toBe(true);
  });

  it("expires at exactly 20 minutes", () => {
    const now = new Date(started.getTime() + 20 * 60 * 1000);
    expect(isAttendanceQrExpired(expires, now)).toBe(true);
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student,
        alreadyCheckedInToday: false,
        serverNow: now.toISOString(),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("stays expired after 21 minutes", () => {
    const now = new Date(started.getTime() + 21 * 60 * 1000);
    expect(isAttendanceQrExpired(expires, now)).toBe(true);
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student,
        alreadyCheckedInToday: false,
        serverNow: now.toISOString(),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });
});

describe("attendance QR access rules", () => {
  it("rejects a duplicate check-in", () => {
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student,
        alreadyCheckedInToday: true,
        serverNow: "2026-10-22T20:01:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "duplicate" });
  });

  it("rejects a student from another academy or inactive student", () => {
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student: { academyId: "other-academy", status: "ativo" },
        alreadyCheckedInToday: false,
        serverNow: "2026-10-22T20:01:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "unauthorized" });
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student: { academyId: "academy-1", status: "inativo" },
        alreadyCheckedInToday: false,
        serverNow: "2026-10-22T20:01:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("rejects an invalid token", () => {
    expect(
      decideAttendanceQrCheckIn({
        token: "forged",
        session,
        student,
        alreadyCheckedInToday: false,
        serverNow: "2026-10-22T20:01:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "invalid_token" });
    expect(
      decideAttendanceQrCheckIn({
        token: "",
        session,
        student,
        alreadyCheckedInToday: false,
        serverNow: "2026-10-22T20:01:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("does not let a manipulated device clock extend validity", () => {
    const serverNow = new Date(started.getTime() + 20 * 60 * 1000);
    const deviceNow = new Date(started.getTime() + 5 * 60 * 1000);
    const offset = deviceClockOffsetMs(deviceNow, serverNow);
    expect(
      remainingAttendanceQrMsAgainstServer(expires, deviceNow, offset),
    ).toBe(0);
    expect(
      decideAttendanceQrCheckIn({
        token: "qr-token",
        session,
        student,
        alreadyCheckedInToday: false,
        serverNow: serverNow.toISOString(),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });
});

describe("attendance QR countdown", () => {
  it("formats remaining time from the server clock", () => {
    expect(formatAttendanceQrCountdown(20 * 60 * 1000)).toBe("20:00");
    expect(formatAttendanceQrCountdown(61_000)).toBe("01:01");
    expect(formatAttendanceQrCountdown(0)).toBe("00:00");
  });
});

describe("attendance QR wiring", () => {
  it("enforces 20 minutes in SQL with Postgres now()", () => {
    const sql = readFileSync(
      resolve(ROOT, "supabase/migrations/20261022220000_attendance_qr_ttl_20m.sql"),
      "utf8",
    );
    expect(sql).toContain("interval '20 minutes'");
    expect(sql).toContain("attendance_sessions_force_qr_expiry");
    expect(sql).toContain("start_attendance_session");
    expect(sql).toContain("attendance_qr_is_expired");
    expect(sql).toContain("_expires_at <= _as_of");
    expect(sql).not.toContain("interval '10 minutes'");
  });

  it("stops the professor UI from choosing the expiry on the device", () => {
    const source = readFileSync(resolve(ROOT, "src/pages/Presencas.tsx"), "utf8");
    expect(source).toContain("start_attendance_session");
    expect(source).toContain("ATTENDANCE_QR_TTL_MINUTES");
    expect(source).not.toContain("10 * 60 * 1000");
    expect(source).not.toContain("válido por 10 minutos");
  });
});
