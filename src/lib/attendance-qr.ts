/** Official attendance QR lifetime. Backend `now()` is the source of truth. */
export const ATTENDANCE_QR_TTL_MINUTES = 20;
export const ATTENDANCE_QR_TTL_MS = ATTENDANCE_QR_TTL_MINUTES * 60 * 1000;

export type AttendanceQrDenyReason =
  | "invalid_token"
  | "expired"
  | "ended"
  | "duplicate"
  | "unauthorized";

export type AttendanceQrDecision =
  | { ok: true }
  | { ok: false; reason: AttendanceQrDenyReason };

function toMs(value: Date | string | number): number {
  if (typeof value === "number") return value;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

export function computeAttendanceQrExpiresAt(startedAt: Date | string): Date {
  return new Date(toMs(startedAt) + ATTENDANCE_QR_TTL_MS);
}

/** Expired at the exact TTL instant (`expires_at <= now()`), matching Postgres. */
export function isAttendanceQrExpired(
  expiresAt: Date | string,
  now: Date | string,
): boolean {
  return toMs(now) >= toMs(expiresAt);
}

export function remainingAttendanceQrMs(
  expiresAt: Date | string,
  trustedNow: Date | string,
): number {
  return Math.max(0, toMs(expiresAt) - toMs(trustedNow));
}

/** `deviceNow - serverNow`. Positive when the device clock is ahead. */
export function deviceClockOffsetMs(
  deviceNow: Date | string,
  serverNow: Date | string,
): number {
  return toMs(deviceNow) - toMs(serverNow);
}

/**
 * Countdown using a sampled server clock. A manipulated device clock cannot
 * extend remaining time because `trustedNow = deviceNow - offset`.
 */
export function remainingAttendanceQrMsAgainstServer(
  expiresAt: Date | string,
  deviceNow: Date | string,
  clockOffsetMs: number,
): number {
  const trustedNow = toMs(deviceNow) - clockOffsetMs;
  return Math.max(0, toMs(expiresAt) - trustedNow);
}

export function formatAttendanceQrCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function decideAttendanceQrCheckIn(input: {
  token: string | null | undefined;
  session: {
    token: string;
    expiresAt: string;
    endedAt: string | null;
    academyId: string;
  } | null;
  student: { academyId: string; status: string } | null;
  alreadyCheckedInToday: boolean;
  serverNow: string;
}): AttendanceQrDecision {
  const token = String(input.token ?? "").trim();
  if (!token || !input.session || input.session.token !== token) {
    return { ok: false, reason: "invalid_token" };
  }
  if (input.session.endedAt) {
    return { ok: false, reason: "ended" };
  }
  if (isAttendanceQrExpired(input.session.expiresAt, input.serverNow)) {
    return { ok: false, reason: "expired" };
  }
  if (
    !input.student ||
    input.student.academyId !== input.session.academyId ||
    input.student.status !== "ativo"
  ) {
    return { ok: false, reason: "unauthorized" };
  }
  if (input.alreadyCheckedInToday) {
    return { ok: false, reason: "duplicate" };
  }
  return { ok: true };
}
