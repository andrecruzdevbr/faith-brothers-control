import { describe, expect, it } from "vitest";
import { loadMyBillings, type MyBillingRow, type MyBillingStudent } from "@/lib/my-billings";

const student: MyBillingStudent = {
  id: "stu-1",
  plan_id: "plan-1",
  status: "ativo",
  approved_at: "2026-01-01",
  payment_review_status: null,
  registration_audience: "new_student",
  requested_training_days: 3,
  requested_payment_method: null,
  plans: { name: "Mensal" },
};

const billing: MyBillingRow = {
  id: "b-1",
  status: "pendente",
  amount: 230,
  due_date: "2026-10-15",
  reference_month: "2026-10-01",
  paid_at: null,
  boleto_url: "https://example.test/boleto",
  invoice_number: null,
};

describe("loadMyBillings", () => {
  it("throws on missing authentication", async () => {
    await expect(
      loadMyBillings({
        getUser: async () => ({ user: null }),
        loadStudent: async () => ({ data: student, error: null }),
        loadBillings: async () => ({ data: [billing], error: null }),
      }),
    ).rejects.toThrow(/Não autenticado/);
  });

  it("throws when the student query fails", async () => {
    await expect(
      loadMyBillings({
        getUser: async () => ({ user: { id: "u1" } }),
        loadStudent: async () => ({ data: null, error: { message: "permission denied for table students" } }),
        loadBillings: async () => ({ data: [billing], error: null }),
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("throws when billings fail instead of pretending there are none", async () => {
    await expect(
      loadMyBillings({
        getUser: async () => ({ user: { id: "u1" } }),
        loadStudent: async () => ({ data: student, error: null }),
        loadBillings: async () => ({ data: null, error: { message: "Failed to fetch" } }),
      }),
    ).rejects.toThrow(/Failed to fetch/);
  });

  it("returns no student without calling that a billing-empty success of a missing profile", async () => {
    await expect(
      loadMyBillings({
        getUser: async () => ({ user: { id: "u1" } }),
        loadStudent: async () => ({ data: null, error: null }),
        loadBillings: async () => ({ data: [billing], error: null }),
      }),
    ).resolves.toEqual({ student: null, billings: [] });
  });

  it("returns a real empty billing history when queries succeed", async () => {
    await expect(
      loadMyBillings({
        getUser: async () => ({ user: { id: "u1" } }),
        loadStudent: async () => ({ data: student, error: null }),
        loadBillings: async () => ({ data: [], error: null }),
      }),
    ).resolves.toEqual({ student, billings: [] });
  });

  it("returns billings after a successful load", async () => {
    const result = await loadMyBillings({
      getUser: async () => ({ user: { id: "u1" } }),
      loadStudent: async () => ({ data: student, error: null }),
      loadBillings: async () => ({ data: [billing], error: null }),
    });
    expect(result.student?.id).toBe("stu-1");
    expect(result.billings).toHaveLength(1);
  });

  it("loads billings only for the authenticated student's own id", async () => {
    const seen: string[] = [];
    await loadMyBillings({
      getUser: async () => ({ user: { id: "u1" } }),
      loadStudent: async (userId) => {
        expect(userId).toBe("u1");
        return { data: student, error: null };
      },
      loadBillings: async (studentId) => {
        seen.push(studentId);
        return { data: [billing], error: null };
      },
    });
    expect(seen).toEqual(["stu-1"]);
  });
});
