import { useMemo, useState } from "react";
import {
  AUDIENCE_LABELS,
  MODALITY_LABELS,
  displayClassNotes,
  CLASS_SCHEDULE_IDLE_EMPTY,
  classScheduleEmptyMessage,
  filterClassSchedules,
  formatClassTitle,
  formatStartTime,
  groupClassSchedulesByDay,
  isNogi,
  type ClassScheduleRow,
} from "@/lib/class-schedules";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock } from "lucide-react";

type Props = {
  rows: ClassScheduleRow[];
  loading?: boolean;
  title?: string | null;
  showFilters?: boolean;
  emptyMessage?: string;
};

export function ClassScheduleBoard({
  rows,
  loading = false,
  title = "Turmas e Horários",
  showFilters = true,
  emptyMessage = CLASS_SCHEDULE_IDLE_EMPTY,
}: Props) {
  const [audience, setAudience] = useState<string>("all");
  const [modality, setModality] = useState<string>("all");

  const filtered = useMemo(
    () => filterClassSchedules(rows, { audience, modality }),
    [rows, audience, modality],
  );
  const groups = useMemo(() => groupClassSchedulesByDay(filtered), [filtered]);
  const emptyStateMessage = classScheduleEmptyMessage({
    rowCount: rows.length,
    filteredCount: filtered.length,
    audience,
    modality,
    idleMessage: emptyMessage,
  });

  if (loading) {
    return (
      <div className="space-y-3">
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {title ? (
          <p className="text-sm font-semibold tracking-wide uppercase text-foreground">{title}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">Agenda oficial da academia (somente consulta).</p>
      </div>

      {showFilters ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Select value={audience} onValueChange={setAudience}>
            <SelectTrigger>
              <SelectValue placeholder="Público" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os públicos</SelectItem>
              <SelectItem value="infantil">{AUDIENCE_LABELS.infantil}</SelectItem>
              <SelectItem value="adulto">{AUDIENCE_LABELS.adulto}</SelectItem>
              <SelectItem value="feminino">{AUDIENCE_LABELS.feminino}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modality} onValueChange={setModality}>
            <SelectTrigger>
              <SelectValue placeholder="Modalidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">GI e NOGI</SelectItem>
              <SelectItem value="gi">GI / Com kimono</SelectItem>
              <SelectItem value="nogi">NOGI / Sem kimono</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {emptyStateMessage ?? emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <section
              key={group.day}
              className="rounded-xl border border-border bg-card p-4 shadow-card space-y-3"
            >
              <h3 className="font-display text-lg font-bold tracking-wide">{group.labelLong.toUpperCase()}</h3>
              <ul className="space-y-2">
                {group.items.map((item) => {
                  const nogi = isNogi(item);
                  return (
                    <li
                      key={item.id}
                      className={`rounded-lg border px-3 py-2.5 ${
                        nogi
                          ? "border-amber-500/40 bg-amber-500/10"
                          : "border-border/80 bg-background/60"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Clock className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-semibold tabular-nums">
                            {formatStartTime(item.start_time)}
                          </p>
                          <p className="text-sm text-foreground">{formatClassTitle(item)}</p>
                          {nogi ? (
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                              {MODALITY_LABELS.nogi}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">{MODALITY_LABELS.gi}</p>
                          )}
                          {displayClassNotes(item.notes) ? (
                            <p className="text-xs text-muted-foreground">{displayClassNotes(item.notes)}</p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
