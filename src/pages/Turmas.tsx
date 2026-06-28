import { motion } from "framer-motion";
import { CalendarDays, Clock, Users, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useClasses } from "@/hooks/useQueries";

type ClassRow = {
  id: string;
  name: string;
  schedule_days?: string;
  schedule_time?: string;
  student_count?: number;
};

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
  const { data: classes, isLoading, isError, error } = useClasses();

  if (isLoading) return <TurmasSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">TURMAS</h1>
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error instanceof Error ? error.message : "Erro ao carregar turmas."}</p>
        </div>
      </div>
    );
  }

  const turmas = (classes ?? []) as ClassRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">TURMAS</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {turmas.length} {turmas.length === 1 ? "turma ativa" : "turmas ativas"}
        </p>
      </div>

      {turmas.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Nenhuma turma cadastrada no momento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {turmas.map((turma, i) => (
            <motion.div
              key={turma.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-xl border border-border bg-card p-5 shadow-card hover:border-primary/30 transition-colors"
            >
              <h3 className="font-display text-xl font-bold text-foreground">{turma.name}</h3>
              <div className="mt-3 space-y-2">
                {turma.schedule_days && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4 text-primary shrink-0" />
                    {turma.schedule_days}
                  </div>
                )}
                {turma.schedule_time && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 text-primary shrink-0" />
                    {turma.schedule_time}
                  </div>
                )}
                {typeof turma.student_count === "number" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 text-primary shrink-0" />
                    {turma.student_count} {turma.student_count === 1 ? "aluno" : "alunos"}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Turmas;
