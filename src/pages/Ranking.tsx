import { motion } from "framer-motion";
import { Medal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRanking } from "@/hooks/useQueries";

const medals = ["🥇", "🥈", "🥉"];

function getNivel(treinos: number) {
  if (treinos >= 18) return { label: "Ouro", class: "text-warning bg-warning/10" };
  if (treinos >= 12) return { label: "Prata", class: "text-muted-foreground bg-secondary" };
  return { label: "Bronze", class: "text-amber-700 bg-amber-900/20" };
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

const Ranking = () => {
  const { data: ranking, isLoading } = useRanking();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const top3 = (ranking ?? []).slice(0, 3);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">RANKING</h1>
        <p className="text-sm text-muted-foreground mt-1">Treinos nos últimos 30 dias</p>
      </div>

      {top3.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          {[1, 0, 2].map((idx) => {
            const aluno = top3[idx];
            if (!aluno) return <div key={`empty-${idx}`} className="hidden sm:block" />;
            const nivel = getNivel(aluno.treinos);
            const isFirst = idx === 0;
            return (
              <motion.div
                key={aluno.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={`rounded-xl border bg-card p-5 shadow-card text-center ${
                  isFirst ? "border-primary/40 sm:order-2" : idx === 1 ? "sm:order-1" : "sm:order-3"
                }`}
              >
                <p className="text-3xl mb-2">{medals[idx]}</p>
                <div className={`rounded-full gradient-primary flex items-center justify-center mx-auto mb-2 font-bold text-primary-foreground ${isFirst ? "w-16 h-16 text-base" : "w-14 h-14 text-sm"}`}>
                  {getInitials(aluno.full_name)}
                </div>
                <p className="font-display font-bold text-foreground">{aluno.full_name}</p>
                <p className="text-xs text-muted-foreground">{aluno.belt ?? "Branca"}</p>
                <p className="text-2xl font-display font-bold text-primary mt-2">{aluno.treinos}</p>
                <p className="text-xs text-muted-foreground">treinos</p>
                <span className={`inline-block mt-2 text-xs font-medium px-2 py-1 rounded-full ${nivel.class}`}>{nivel.label}</span>
              </motion.div>
            );
          })}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
      >
        {(ranking ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nenhum treino registrado nos últimos 30 dias.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-16">#</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Aluno</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Treinos</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Pontos</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Nível</th>
                </tr>
              </thead>
              <tbody>
                {(ranking ?? []).map((a, index) => {
                  const pos = index + 1;
                  const nivel = getNivel(a.treinos);
                  const pontos = a.treinos * 100;
                  return (
                    <tr key={a.id} className={`border-b border-border/50 ${pos <= 3 ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3 text-lg">{pos <= 3 ? medals[pos - 1] : `${pos}º`}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                            {getInitials(a.full_name)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{a.full_name}</p>
                            <p className="text-xs text-muted-foreground">{a.belt ?? "Branca"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-display font-bold text-primary text-lg">{a.treinos}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{pontos} pts</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${nivel.class}`}>{nivel.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {(ranking ?? []).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <div className="flex items-center gap-2 mb-2">
            <Medal className="h-5 w-5 text-primary" />
            <h3 className="font-display text-sm font-bold tracking-wider">COMO FUNCIONA</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            O ranking considera check-ins registrados nos últimos 30 dias. Ouro: 18+ treinos • Prata: 12–17 • Bronze: até 11.
            Pontos = treinos × 100.
          </p>
        </motion.div>
      )}
    </div>
  );
};

export default Ranking;
