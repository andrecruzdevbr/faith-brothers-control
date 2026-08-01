import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { hasValidStudentWhatsapp } from "./billing-settings.ts";
import { todayInSaoPaulo } from "./student-age.ts";
import { queueWhatsApp, type QueueWhatsAppResult } from "./whatsapp.ts";
import { buildBirthdayMessage } from "./whatsapp-messages.ts";

export type BirthdayStudentRow = {
  id: string;
  academy_id: string;
  full_name: string;
  whatsapp: string | null;
  birth_date: string | null;
  status: string;
  academies?: { name: string } | { name: string }[] | null;
};

export type BirthdayRunSummary = {
  success: true;
  date: string;
  year: number;
  found: number;
  queued: number;
  skipped_duplicate: number;
  skipped_invalid_whatsapp: number;
  failed: number;
};

type QueueFn = (params: {
  supabase: SupabaseClient;
  recipient: string;
  body: string;
  messageType: "birthday";
  academyId?: string | null;
  studentId?: string | null;
  sendImmediately?: boolean;
}) => Promise<QueueWhatsAppResult>;

function academyNameFromRow(row: BirthdayStudentRow): string | null {
  const raw = row.academies;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0]?.name ?? null;
  return raw.name ?? null;
}

export async function runBirthdayWhatsAppJob(params: {
  supabase: SupabaseClient;
  now?: Date;
  queueWhatsAppFn?: QueueFn;
}): Promise<BirthdayRunSummary> {
  const supabase = params.supabase;
  const queueFn = params.queueWhatsAppFn ?? queueWhatsApp;
  const dateStr = todayInSaoPaulo(params.now ?? new Date());
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const summary: BirthdayRunSummary = {
    success: true,
    date: dateStr,
    year,
    found: 0,
    queued: 0,
    skipped_duplicate: 0,
    skipped_invalid_whatsapp: 0,
    failed: 0,
  };

  const { data: students, error } = await supabase
    .from("students")
    .select("id, academy_id, full_name, whatsapp, birth_date, status, academies(name)")
    .eq("status", "ativo")
    .not("birth_date", "is", null);

  if (error) throw new Error(error.message);

  const todayBirthdays = ((students ?? []) as BirthdayStudentRow[]).filter((s) => {
    if (!s.birth_date) return false;
    const parts = s.birth_date.slice(0, 10).split("-");
    if (parts.length !== 3) return false;
    return Number(parts[1]) === month && Number(parts[2]) === day;
  });

  summary.found = todayBirthdays.length;

  for (const student of todayBirthdays) {
    if (!hasValidStudentWhatsapp(student.whatsapp)) {
      summary.skipped_invalid_whatsapp += 1;
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("birthday_messages")
      .insert({
        student_id: student.id,
        academy_id: student.academy_id,
        birthday_year: year,
        status: "queued",
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      // unique violation → já enviado neste ano
      if (insertError.code === "23505" || /duplicate|unique/i.test(insertError.message)) {
        summary.skipped_duplicate += 1;
        continue;
      }
      summary.failed += 1;
      continue;
    }

    if (!inserted?.id) {
      summary.skipped_duplicate += 1;
      continue;
    }

    try {
      const body = buildBirthdayMessage(student.full_name, academyNameFromRow(student));
      const queueResult = await queueFn({
        supabase,
        recipient: String(student.whatsapp),
        body,
        messageType: "birthday",
        academyId: student.academy_id,
        studentId: student.id,
        // Insere na fila e tenta envio (mesmo padrão das cobranças).
        sendImmediately: true,
      });

      await supabase
        .from("birthday_messages")
        .update({
          message_id: queueResult.messageId,
          status: queueResult.sent ? "sent" : queueResult.skipped ? "queued" : "queued",
          sent_at: queueResult.sent ? new Date().toISOString() : null,
          error_message: queueResult.reason ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);

      summary.queued += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "queue_failed";
      await supabase
        .from("birthday_messages")
        .update({
          status: "failed",
          error_message: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);
      summary.failed += 1;
    }
  }

  return summary;
}
