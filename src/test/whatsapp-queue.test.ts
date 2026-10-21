import { describe, expect, it, vi } from "vitest";
import {
  isClaimableWhatsAppStatus,
  processPendingMessages,
  resolveStuckWhatsAppAction,
  STUCK_PROCESSING_MS,
} from "../../supabase/functions/_shared/whatsapp.ts";

type Row = {
  id: string;
  status: string;
  recipient: string;
  body: string;
  attempts: number;
  updated_at: string;
  external_id: string | null;
  error_message?: string | null;
  sent_at?: string | null;
  created_at: string;
};

function createConcurrentQueueStore(initial: Row) {
  const shared = { ...initial };
  let processingOwner: string | null = null;

  function from() {
    return {
      select(_cols?: string) {
        const state = {
          statusEq: null as string | null,
          statusIn: null as string[] | null,
          updatedBefore: null as string | null,
        };
        const api = {
          eq(column: string, value: unknown) {
            if (column === "status") state.statusEq = String(value);
            return api;
          },
          in(column: string, values: unknown[]) {
            if (column === "status") state.statusIn = values.map(String);
            return api;
          },
          lt(column: string, value: string) {
            if (column === "updated_at") state.updatedBefore = value;
            if (column === "attempts") {
              /* filter applied in limit */
            }
            return api;
          },
          order() {
            return api;
          },
          limit(_n: number) {
            let data: Row[] = [];
            if (state.statusEq === "processing") {
              if (
                shared.status === "processing" &&
                state.updatedBefore &&
                shared.updated_at < state.updatedBefore
              ) {
                data = [shared];
              }
            } else if (state.statusIn?.includes(shared.status) && shared.attempts < 3) {
              data = [shared];
            }
            return Promise.resolve({ data });
          },
        };
        return api;
      },
      update(payload: Record<string, unknown>) {
        const state = {
          id: null as string | null,
          statusEq: null as string | null,
          statusIn: null as string[] | null,
        };
        const api = {
          eq(column: string, value: unknown) {
            if (column === "id") state.id = String(value);
            if (column === "status") state.statusEq = String(value);
            return api;
          },
          in(column: string, values: unknown[]) {
            if (column === "status") state.statusIn = values.map(String);
            return api;
          },
          select() {
            return {
              maybeSingle() {
                if (state.id && state.id !== shared.id) {
                  return Promise.resolve({ data: null, error: null });
                }
                if (payload.status === "processing") {
                  const claimable =
                    (!state.statusIn || state.statusIn.includes(shared.status)) &&
                    (shared.status === "pending" || shared.status === "failed");
                  if (!claimable || processingOwner) {
                    return Promise.resolve({ data: null, error: null });
                  }
                  processingOwner = "worker";
                  Object.assign(shared, payload);
                  return Promise.resolve({ data: { id: shared.id }, error: null });
                }
                if (state.statusEq && shared.status !== state.statusEq) {
                  return Promise.resolve({ data: null, error: null });
                }
                Object.assign(shared, payload);
                return Promise.resolve({ data: { id: shared.id }, error: null });
              },
            };
          },
          then(resolve: (v: { data: null; error: null }) => unknown) {
            if (state.statusEq && shared.status !== state.statusEq) {
              return Promise.resolve({ data: null, error: null }).then(resolve);
            }
            Object.assign(shared, payload);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        return api;
      },
    };
  }

  return { shared, supabase: { from } };
}

describe("whatsapp queue concurrency", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");

  it("only pending/failed are claimable", () => {
    expect(isClaimableWhatsAppStatus("pending")).toBe(true);
    expect(isClaimableWhatsAppStatus("failed")).toBe(true);
    expect(isClaimableWhatsAppStatus("processing")).toBe(false);
    expect(isClaimableWhatsAppStatus("sent")).toBe(false);
  });

  it("marks stuck processing with external_id as sent (no resend)", () => {
    const stuckAt = new Date(now.getTime() - STUCK_PROCESSING_MS - 1_000).toISOString();
    expect(
      resolveStuckWhatsAppAction(
        { status: "processing", updated_at: stuckAt, external_id: "evo-1" },
        now,
      ),
    ).toBe("mark_sent");
  });

  it("reclaims stuck processing without external_id", () => {
    const stuckAt = new Date(now.getTime() - STUCK_PROCESSING_MS - 1_000).toISOString();
    expect(
      resolveStuckWhatsAppAction(
        { status: "processing", updated_at: stuckAt, external_id: null },
        now,
      ),
    ).toBe("reclaim_pending");
  });

  it("leaves fresh processing alone", () => {
    expect(
      resolveStuckWhatsAppAction(
        { status: "processing", updated_at: now.toISOString(), external_id: null },
        now,
      ),
    ).toBe("leave");
  });

  it("second worker loses the claim and does not send", async () => {
    const { shared, supabase } = createConcurrentQueueStore({
      id: "m1",
      status: "pending",
      recipient: "5511999999999",
      body: "hello",
      attempts: 0,
      updated_at: now.toISOString(),
      external_id: null,
      created_at: now.toISOString(),
    });

    const sendA = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, externalId: "evo-a" };
    });
    const sendB = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, externalId: "evo-b" };
    });

    const [countA, countB] = await Promise.all([
      processPendingMessages(supabase as never, { limit: 5, now: () => now, sendFn: sendA }),
      processPendingMessages(supabase as never, { limit: 5, now: () => now, sendFn: sendB }),
    ]);

    expect(sendA.mock.calls.length + sendB.mock.calls.length).toBe(1);
    expect(countA + countB).toBe(1);
    expect(shared.status).toBe("sent");
    expect(["evo-a", "evo-b"]).toContain(shared.external_id);
  });

  it("preserves external_id when confirm update fails after successful send", async () => {
    const store: Row = {
      id: "m2",
      status: "pending",
      recipient: "5511888888888",
      body: "oi",
      attempts: 0,
      updated_at: now.toISOString(),
      external_id: null,
      created_at: now.toISOString(),
    };

    let confirmAttempts = 0;
    const supabase = {
      from() {
        return {
          select() {
            const state = { statusEq: null as string | null, statusIn: null as string[] | null };
            const api = {
              eq(column: string, value: unknown) {
                if (column === "status") state.statusEq = String(value);
                return api;
              },
              in(column: string, values: unknown[]) {
                if (column === "status") state.statusIn = values.map(String);
                return api;
              },
              lt() {
                return api;
              },
              order() {
                return api;
              },
              limit() {
                if (state.statusEq === "processing") return Promise.resolve({ data: [] });
                if (state.statusIn?.includes("pending") && store.status === "pending") {
                  return Promise.resolve({ data: [store] });
                }
                return Promise.resolve({ data: [] });
              },
            };
            return api;
          },
          update(payload: Record<string, unknown>) {
            const api = {
              eq() {
                return api;
              },
              in() {
                return api;
              },
              select() {
                return {
                  maybeSingle() {
                    if (payload.status === "processing") {
                      store.status = "processing";
                      store.updated_at = String(payload.updated_at);
                      return Promise.resolve({ data: { id: store.id }, error: null });
                    }
                    if (payload.status === "sent") {
                      confirmAttempts += 1;
                      if (confirmAttempts === 1) {
                        return Promise.resolve({
                          data: null,
                          error: { message: "confirm race" },
                        });
                      }
                    }
                    Object.assign(store, payload);
                    return Promise.resolve({ data: { id: store.id }, error: null });
                  },
                };
              },
              then(resolve: (v: { data: null; error: null }) => unknown) {
                Object.assign(store, payload);
                return Promise.resolve({ data: null, error: null }).then(resolve);
              },
            };
            return api;
          },
        };
      },
    };

    await processPendingMessages(supabase as never, {
      now: () => now,
      sendFn: async () => ({ ok: true, externalId: "evo-recover" }),
    });

    expect(store.external_id).toBe("evo-recover");
    expect(store.error_message).toBe("sent_pending_db_confirm");
  });

  it("reclaim marks previously sent-but-unconfirmed messages as sent without calling Evolution", async () => {
    const stuckAt = new Date(now.getTime() - STUCK_PROCESSING_MS - 5_000).toISOString();
    const store: Row = {
      id: "m3",
      status: "processing",
      recipient: "5511777777777",
      body: "x",
      attempts: 1,
      updated_at: stuckAt,
      external_id: "evo-already",
      created_at: stuckAt,
      error_message: "sent_pending_db_confirm",
    };

    const sendFn = vi.fn(async () => ({ ok: true, externalId: "should-not-send" }));
    const supabase = {
      from() {
        return {
          select() {
            const state = { statusEq: null as string | null, statusIn: null as string[] | null };
            const api = {
              eq(column: string, value: unknown) {
                if (column === "status") state.statusEq = String(value);
                return api;
              },
              in(column: string, values: unknown[]) {
                if (column === "status") state.statusIn = values.map(String);
                return api;
              },
              lt() {
                return api;
              },
              order() {
                return api;
              },
              limit() {
                if (state.statusEq === "processing" && store.status === "processing") {
                  return Promise.resolve({ data: [store] });
                }
                return Promise.resolve({ data: [] });
              },
            };
            return api;
          },
          update(payload: Record<string, unknown>) {
            const api = {
              eq() {
                return api;
              },
              in() {
                return api;
              },
              select() {
                return {
                  maybeSingle() {
                    Object.assign(store, payload);
                    return Promise.resolve({ data: { id: store.id }, error: null });
                  },
                };
              },
              then(resolve: (v: { data: null; error: null }) => unknown) {
                Object.assign(store, payload);
                return Promise.resolve({ data: null, error: null }).then(resolve);
              },
            };
            return api;
          },
        };
      },
    };

    await processPendingMessages(supabase as never, { now: () => now, sendFn });
    expect(sendFn).not.toHaveBeenCalled();
    expect(store.status).toBe("sent");
    expect(store.external_id).toBe("evo-already");
  });
});
