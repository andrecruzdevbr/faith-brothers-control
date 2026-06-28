import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BELT_ORDER = ["Preta", "Marrom", "Roxa", "Azul", "Branca"];
const BELT_COLORS: Record<string, string> = {
  Preta: "bg-foreground",
  Marrom: "bg-amber-800",
  Roxa: "bg-purple-600",
  Azul: "bg-blue-600",
  Branca: "bg-gray-200",
};

type Student = {
  id: string;
  full_name: string;
  belt: string | null;
  degrees: number;
  profile_user_id: string | null;
};

const MinhaGraduacao = () => {
  const { user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [myStudent, setMyStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user?.academyId) return;

      const { data } = await supabase
        .from("students")
        .select("id, full_name, belt, degrees, profile_user_id")
        .eq("academy_id", user.academyId)
        .eq("status", "ativo");

      if (data) {
        const sorted = [...data].sort((a, b) => {
          const aIdx = BELT_ORDER.indexOf(a.belt || "Branca");
          const bIdx = BELT_ORDER.indexOf(b.belt || "Branca");
          if (aIdx !== bIdx) return aIdx - bIdx;
          return (b.degrees || 0) - (a.degrees || 0);
        });

        setStudents(sorted);
        const me = sorted.find((s) => s.profile_user_id === user.id);
        setMyStudent(me || null);
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
      <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">MINHA GRADUAÇÃO</h1>

      {/* Destaque do aluno logado */}
      {myStudent && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border-2 border-primary bg-card p-6 shadow-card"
        >
          <div className="flex items-center gap-4">
            <div className={`w-16 h-4 rounded-full ${BELT_COLORS[myStudent.belt || "Branca"] || "bg-gray-200"}`} />
            <div>
              <p className="font-display text-xl font-bold text-foreground">{myStudent.full_name}</p>
              <p className="text-sm text-muted-foreground">
                Faixa {myStudent.belt || "Branca"} • {myStudent.degrees} {myStudent.degrees === 1 ? "grau" : "graus"}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Ranking por graduação */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-xl border border-border bg-card p-5 shadow-card"
      >
        <div className="flex items-center gap-2 mb-4">
          <Award className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">RANKING POR GRADUAÇÃO</h3>
        </div>
        <div className="space-y-2">
          {students.map((s, i) => {
            const isMe = s.profile_user_id === user?.id;
            return (
              <div
                key={s.id}
                className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                  isMe ? "bg-primary/10 border border-primary/30" : "bg-secondary/30"
                }`}
              >
                <span className="text-xs font-bold text-muted-foreground w-6 text-center">
                  {i + 1}º
                </span>
                <div className={`w-8 h-2 rounded-full ${BELT_COLORS[s.belt || "Branca"] || "bg-gray-200"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isMe ? "text-primary font-bold" : "text-foreground"}`}>
                    {s.full_name} {isMe && "(Você)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.belt || "Branca"} • {s.degrees} {s.degrees === 1 ? "grau" : "graus"}
                  </p>
                </div>
              </div>
            );
          })}
          {students.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum aluno encontrado</p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default MinhaGraduacao;
