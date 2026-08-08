import { useMemo, useState } from "react";
import { AlertCircle, Pencil, Plus, Power } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClassScheduleBoard } from "@/components/ClassScheduleBoard";
import { useAcademyId, useClasses } from "@/hooks/useQueries";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminRole, isAcademyLimitedRole } from "@/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  AUDIENCE_LABELS,
  LEVEL_LABELS,
  MODALITY_LABELS,
  WEEKDAY_LABELS,
  formatStartTime,
  type ClassAudience,
  type ClassLevel,
  type ClassModality,
  type ClassScheduleRow,
} from "@/lib/class-schedules";

type Draft = {
  id?: string;
  name: string;
  day_of_week: string;
  start_time: string;
  audience: ClassAudience;
  level: ClassLevel | "";
  modality: ClassModality;
  notes: string;
  sort_order: string;
  active: boolean;
};

const emptyDraft = (): Draft => ({
  name: "Adulto iniciante/avançado",
  day_of_week: "1",
  start_time: "19:45",
  audience: "adulto",
  level: "iniciante_avancado",
  modality: "gi",
  notes: "",
  sort_order: "30",
  active: true,
});

const TurmasSkeleton = () => (
  <div className="space-y-6">
    <Skeleton className="h-10 w-48" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-40 rounded-xl" />
      ))}
    </div>
  </div>
);

const Turmas = () => {
  const { toast } = useToast();
  const { roles } = useAuth();
  const { data: academyId } = useAcademyId();
  const canManage = isAdminRole(roles) || isAcademyLimitedRole(roles);
  const { data: classes, isLoading, isError, error } = useClasses({
    includeInactive: canManage,
  });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const rows = useMemo(() => (classes ?? []) as ClassScheduleRow[], [classes]);
  const activeRows = useMemo(() => rows.filter((r) => r.active !== false), [rows]);

  const saveMutation = useMutation({
    mutationFn: async (values: Draft) => {
      if (!academyId) throw new Error("Academia não encontrada");
      const day = Number(values.day_of_week);
      const payload = {
        academy_id: academyId,
        name: values.name.trim(),
        day_of_week: day,
        start_time: values.start_time.length === 5 ? `${values.start_time}:00` : values.start_time,
        audience: values.audience,
        level: values.level || null,
        modality: values.modality,
        notes: values.notes.trim() || null,
        sort_order: Number(values.sort_order || 0),
        active: values.active,
        schedule_days: WEEKDAY_LABELS[day] ?? "",
        schedule_time: values.start_time.slice(0, 5),
        updated_at: new Date().toISOString(),
      };
      if (values.id) {
        const { error: updateError } = await supabase.from("classes").update(payload).eq("id", values.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from("classes").insert(payload);
        if (insertError) throw insertError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      await queryClient.invalidateQueries({ queryKey: ["public-class-schedules"] });
      setOpen(false);
      toast({ title: "Horário salvo" });
    },
    onError: (err: Error) => {
      toast({ title: "Não foi possível salvar", description: err.message, variant: "destructive" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (row: ClassScheduleRow) => {
      const { error: updateError } = await supabase
        .from("classes")
        .update({ active: !(row.active !== false), updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updateError) throw updateError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      await queryClient.invalidateQueries({ queryKey: ["public-class-schedules"] });
    },
    onError: (err: Error) => {
      toast({ title: "Falha ao alterar status", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <TurmasSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">TURMAS E HORÁRIOS</h1>
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error instanceof Error ? error.message : "Erro ao carregar turmas."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">TURMAS E HORÁRIOS</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agenda oficial · {activeRows.length} horário{activeRows.length === 1 ? "" : "s"} ativo
            {activeRows.length === 1 ? "" : "s"}
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            onClick={() => {
              setDraft(emptyDraft());
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Novo horário
          </Button>
        ) : null}
      </div>

      <ClassScheduleBoard rows={activeRows} title="Agenda semanal" />

      {canManage ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Gerenciar horários</p>
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <p className="font-medium">
                    {WEEKDAY_LABELS[Number(row.day_of_week)] ?? "—"} · {formatStartTime(row.start_time)} ·{" "}
                    {row.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {AUDIENCE_LABELS[row.audience as ClassAudience] ?? row.audience}
                    {row.level ? ` · ${LEVEL_LABELS[row.level as ClassLevel] ?? row.level}` : ""}
                    {" · "}
                    {MODALITY_LABELS[row.modality as ClassModality] ?? row.modality}
                    {row.active === false ? " · inativo" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraft({
                        id: row.id,
                        name: row.name,
                        day_of_week: String(row.day_of_week),
                        start_time: formatStartTime(row.start_time),
                        audience: (row.audience as ClassAudience) || "adulto",
                        level: (row.level as ClassLevel) || "",
                        modality: (row.modality as ClassModality) || "gi",
                        notes: row.notes && row.notes !== "official_v1" ? row.notes : "",
                        sort_order: String(row.sort_order ?? 0),
                        active: row.active !== false,
                      });
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Editar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => toggleActive.mutate(row)}
                  >
                    <Power className="h-3.5 w-3.5 mr-1" />
                    {row.active === false ? "Ativar" : "Desativar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Editar horário" : "Novo horário"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome / categoria</Label>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Dia</Label>
                <Select
                  value={draft.day_of_week}
                  onValueChange={(v) => setDraft((d) => ({ ...d, day_of_week: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {WEEKDAY_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Horário</Label>
                <Input
                  type="time"
                  value={draft.start_time}
                  onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Público</Label>
                <Select
                  value={draft.audience}
                  onValueChange={(v) => setDraft((d) => ({ ...d, audience: v as ClassAudience }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="infantil">Infantil</SelectItem>
                    <SelectItem value="adulto">Adulto</SelectItem>
                    <SelectItem value="feminino">Feminino</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Nível</Label>
                <Select
                  value={draft.level || "none"}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, level: v === "none" ? "" : (v as ClassLevel) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="iniciante">iniciante</SelectItem>
                    <SelectItem value="avancado">avançado</SelectItem>
                    <SelectItem value="iniciante_avancado">iniciante/avançado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Modalidade</Label>
                <Select
                  value={draft.modality}
                  onValueChange={(v) => setDraft((d) => ({ ...d, modality: v as ClassModality }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gi">GI / Com kimono</SelectItem>
                    <SelectItem value="nogi">NOGI / Sem kimono</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Ordem</Label>
                <Input
                  inputMode="numeric"
                  value={draft.sort_order}
                  onChange={(e) => setDraft((d) => ({ ...d, sort_order: e.target.value.replace(/\D/g, "") }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(draft)}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Turmas;
