import { ClassScheduleBoard } from "@/components/ClassScheduleBoard";
import { useClasses } from "@/hooks/useQueries";
import type { ClassScheduleRow } from "@/lib/class-schedules";
import { Skeleton } from "@/components/ui/skeleton";

const MinhasTurmas = () => {
  const { data, isLoading, isError, error } = useClasses();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-display font-bold tracking-wider">TURMAS E HORÁRIOS</h1>
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Não foi possível carregar os horários."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">TURMAS E HORÁRIOS</h1>
        <p className="text-sm text-muted-foreground mt-1">Agenda oficial da sua academia</p>
      </div>
      <ClassScheduleBoard rows={(data ?? []) as ClassScheduleRow[]} />
    </div>
  );
};

export default MinhasTurmas;
