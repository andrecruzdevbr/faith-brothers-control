export type MyBillingStudent = {
  id: string;
  plan_id: string | null;
  status: string;
  approved_at: string | null;
  payment_review_status: string | null;
  registration_audience: string | null;
  requested_training_days: number | null;
  requested_payment_method: string | null;
  plans: unknown;
};

export type MyBillingRow = {
  id: string;
  status: string;
  amount: number;
  due_date: string;
  reference_month: string;
  paid_at: string | null;
  boleto_url: string | null;
  invoice_number: string | null;
};

export type MyBillingsResult = {
  student: MyBillingStudent | null;
  billings: MyBillingRow[];
};

export async function loadMyBillings(deps: {
  getUser: () => Promise<{ user: { id: string } | null }>;
  loadStudent: (userId: string) => Promise<{ data: MyBillingStudent | null; error: { message: string } | null }>;
  loadBillings: (studentId: string) => Promise<{ data: MyBillingRow[] | null; error: { message: string } | null }>;
}): Promise<MyBillingsResult> {
  const { user } = await deps.getUser();
  if (!user) throw new Error("Não autenticado.");

  const studentRes = await deps.loadStudent(user.id);
  if (studentRes.error) throw new Error(studentRes.error.message);
  if (!studentRes.data) return { student: null, billings: [] };

  const billingsRes = await deps.loadBillings(studentRes.data.id);
  if (billingsRes.error) throw new Error(billingsRes.error.message);
  return { student: studentRes.data, billings: billingsRes.data ?? [] };
}
