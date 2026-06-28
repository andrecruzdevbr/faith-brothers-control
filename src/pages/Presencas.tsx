import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle, Calendar, Search, Users, QrCode, StopCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { generateUUID } from "@/lib/uuid";

type StudentEntry = {
  id: string;
  full_name: string;
  belt: string | null;
};

type AttendanceRecord = {
  student_id: string;
  checked_in_at: string;
  full_name?: string;
};

const today = new Date();
const currentMonth = today.getMonth();
const currentYear = today.getFullYear();
const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

const Presencas = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentEntry[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentEntry | null>(null);
  const [studentAttendances, setStudentAttendances] = useState<Set<number>>(new Set());
  const [activeSession, setActiveSession] = useState<{ id: string; token: string } | null>(null);
  const [sessionAttendances, setSessionAttendances] = useState<AttendanceRecord[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);

  // Load students
  useEffect(() => {
    const load = async () => {
      if (!user?.academyId) return;
      const { data } = await supabase
        .from("students")
        .select("id, full_name, belt")
        .eq("academy_id", user.academyId)
        .eq("status", "ativo")
        .order("full_name");
      if (data) setStudents(data);
    };
    void load();
  }, [user]);

  const loadSessionAttendances = useCallback(async (sessionId: string) => {
    const { data } = await supabase
      .from("attendances")
      .select("student_id, checked_in_at")
      .eq("session_id", sessionId)
      .order("checked_in_at");

    if (data) {
      const enriched = data.map((a) => {
        const s = students.find((st) => st.id === a.student_id);
        return { ...a, full_name: s?.full_name };
      });
      setSessionAttendances(enriched);
    }
  }, [students]);

  // Check for active session
  useEffect(() => {
    const checkSession = async () => {
      if (!user?.academyId) return;
      const { data } = await supabase
        .from("attendance_sessions")
        .select("id, token")
        .eq("academy_id", user.academyId)
        .eq("professor_user_id", user.id)
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setActiveSession(data);
        void loadSessionAttendances(data.id);
      }
    };
    void checkSession();
  }, [user, loadSessionAttendances]);

  // Load attendances for selected student
  useEffect(() => {
    const load = async () => {
      if (!selectedStudent) return;
      const startOfMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01T00:00:00`;
      const endOfMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${daysInMonth}T23:59:59`;

      const { data } = await supabase
        .from("attendances")
        .select("checked_in_at")
        .eq("student_id", selectedStudent.id)
        .gte("checked_in_at", startOfMonth)
        .lte("checked_in_at", endOfMonth);

      if (data) {
        setStudentAttendances(new Set(data.map((a) => new Date(a.checked_in_at).getDate())));
      }
    };
    void load();
  }, [selectedStudent]);

  const startSession = async () => {
    if (!user?.academyId) return;
    setLoadingSession(true);
    const token = generateUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    const { data, error } = await supabase
      .from("attendance_sessions")
      .insert({
        academy_id: user.academyId,
        professor_user_id: user.id,
        token,
        expires_at: expiresAt,
      })
      .select("id, token")
      .single();

    if (error) {
      toast({ title: "Erro ao iniciar aula", description: error.message, variant: "destructive" });
    } else if (data) {
      setActiveSession(data);
      setSessionAttendances([]);
      toast({ title: "Aula iniciada!", description: "QR Code gerado. Mostre para os alunos." });
    }
    setLoadingSession(false);
  };

  const endSession = async () => {
    if (!activeSession) return;
    await supabase
      .from("attendance_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", activeSession.id);
    setActiveSession(null);
    setSessionAttendances([]);
    toast({ title: "Aula encerrada", description: "QR Code invalidado." });
  };

  // Realtime subscription for session attendances
  useEffect(() => {
    if (!activeSession) return;
    const channel = supabase
      .channel(`session-${activeSession.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "attendances", filter: `session_id=eq.${activeSession.id}` },
        (payload) => {
          const record = payload.new as AttendanceRecord;
          const s = students.find((st) => st.id === record.student_id);
          setSessionAttendances((prev) => [...prev, { ...record, full_name: s?.full_name }]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSession, students]);

  const filteredStudents = students.filter((a) =>
    a.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">PRESENÇAS</h1>

      {/* QR Code Session */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border bg-card p-5 shadow-card"
      >
        <h3 className="font-display text-lg font-bold tracking-wider mb-4">AULA AO VIVO / PRESENÇA</h3>

        {activeSession ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-4">
              <div className="bg-white p-4 rounded-xl">
                <QRCodeSVG
                  value={JSON.stringify({ token: activeSession.token })}
                  size={220}
                  level="H"
                />
              </div>
              <p className="text-sm text-muted-foreground">QR Code válido por 10 minutos</p>
              <Button variant="destructive" onClick={endSession}>
                <StopCircle className="h-4 w-4 mr-2" />
                Encerrar Aula
              </Button>
            </div>

            {sessionAttendances.length > 0 && (
              <div>
                <h4 className="font-display font-bold text-sm mb-2">
                  Presenças da Aula ({sessionAttendances.length})
                </h4>
                <div className="space-y-1">
                  {sessionAttendances.map((a, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 text-sm">
                      <span className="font-medium">{a.full_name || a.student_id}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.checked_in_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Button onClick={startSession} disabled={loadingSession} className="gradient-primary shadow-glow">
            <QrCode className="h-4 w-4 mr-2" />
            {loadingSession ? "Iniciando..." : "Iniciar Aula"}
          </Button>
        )}
      </motion.div>

      {/* Student attendance history */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar aluno..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-card border-border"
            />
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden max-h-[500px] overflow-y-auto">
            {filteredStudents.map((aluno) => (
              <button
                key={aluno.id}
                onClick={() => setSelectedStudent(aluno)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/50 last:border-b-0 ${
                  selectedStudent?.id === aluno.id
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-secondary/50"
                }`}
              >
                <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                  {aluno.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{aluno.full_name}</p>
                  <p className="text-xs text-muted-foreground">{aluno.belt || "Branca"}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedStudent ? (
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-border bg-card p-5 shadow-card text-center"
              >
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Treinos no Mês</p>
                <p className="text-4xl font-display font-bold text-primary mt-2">{studentAttendances.size}</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="rounded-xl border border-border bg-card p-5 shadow-card"
              >
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="h-5 w-5 text-primary" />
                  <h3 className="font-display text-lg font-bold tracking-wider">
                    {selectedStudent.full_name.toUpperCase()} — {today.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).toUpperCase()}
                  </h3>
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                    <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
                  ))}
                  {Array.from({ length: new Date(currentYear, currentMonth, 1).getDay() }, (_, i) => (
                    <div key={`empty-${i}`} />
                  ))}
                  {days.map((day) => {
                    const trained = studentAttendances.has(day);
                    const isFuture = day > today.getDate();
                    return (
                      <div
                        key={day}
                        className={`aspect-square rounded-lg flex items-center justify-center text-sm font-medium transition-all ${
                          trained
                            ? "gradient-primary text-primary-foreground shadow-glow"
                            : isFuture
                              ? "bg-secondary/30 text-muted-foreground"
                              : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {trained ? <CheckCircle className="h-4 w-4" /> : day}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1"><div className="w-3 h-3 rounded gradient-primary" /> Treinou</div>
                  <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-secondary" /> Não treinou</div>
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-12 shadow-card flex flex-col items-center justify-center text-center">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-display text-lg font-bold text-foreground">Selecione um aluno</h3>
              <p className="text-sm text-muted-foreground mt-1">Escolha um aluno na lista para ver o calendário de presenças</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Presencas;
