import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BELT_ORDER = ["Preta", "Marrom", "Roxa", "Azul", "Branca"];
const BELT_COLORS: Record<string, string> = {
  Preta: "bg-foreground border border-primary",
  Marrom: "bg-amber-800",
  Roxa: "bg-purple-600",
  Azul: "bg-blue-600",
  Branca: "bg-foreground",
};

type StudentRow = {
  id: string;
  full_name: string;
  belt: string | null;
  degrees: number;
};

const Graduacao = () => {
  const { user } = useAuth();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [beltCounts, setBeltCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user?.academyId) return;
      const { data } = await supabase
        .from("students")
        .select("id, full_name, belt, degrees")
        .eq("academy_id", user.academyId)
        .eq("status", "ativo");

      if (data) {
        // Count per belt
        const counts: Record<string, number> = {};
        for (const s of data) {
          const b = s.belt || "Branca";
          counts[b] = (counts[b] || 0) + 1;
        }
        setBeltCounts(counts);

        // Sort by belt rank then degrees
        const sorted = [...data].sort((a, b) => {
          const aIdx = BELT_ORDER.indexOf(a.belt || "Branca");
          const bIdx = BELT_ORDER.indexOf(b.belt || "Branca");
          if (aIdx !== bIdx) return aIdx - bIdx;
          return (b.degrees || 0) - (a.degrees || 0);
        });
        setStudents(sorted);
      }
      setLoading(false);
    };
    void load();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">GRADUAÇÃO</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {BELT_ORDER.map((belt, i) => (
          <motion.div
            key={belt}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="rounded-xl border border-border bg-card p-4 shadow-card text-center"
          >
            <div className={`w-full h-4 rounded-full ${BELT_COLORS[belt]} mb-3`} />
            <p className="font-display font-bold text-foreground">{belt}</p>
            <p className="text-2xl font-display font-bold text-primary mt-1">{beltCounts[belt] || 0}</p>
            <p className="text-xs text-muted-foreground">alunos</p>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-xl border border-border bg-card p-5 shadow-card"
      >
        <div className="flex items-center gap-2 mb-4">
          <Award className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">TODOS OS ALUNOS POR GRADUAÇÃO</h3>
        </div>
        <div className="space-y-2">
          {students.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
              <span className="text-xs font-bold text-muted-foreground w-6 text-center">{i + 1}º</span>
              <div className={`w-8 h-2 rounded-full ${BELT_COLORS[s.belt || "Branca"] || "bg-gray-200"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{s.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.belt || "Branca"} • {s.degrees} {s.degrees === 1 ? "grau" : "graus"}
                </p>
              </div>
            </div>
          ))}
          {students.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum aluno cadastrado</p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default Graduacao;
