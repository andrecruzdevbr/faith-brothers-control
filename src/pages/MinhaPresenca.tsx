import { useEffect, useState, useRef } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { motion } from "framer-motion";
import { CheckCircle, Calendar, QrCode, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const MinhaPresenca = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [trainedDays, setTrainedDays] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  useEffect(() => {
    const loadAttendances = async () => {
      if (!user?.id) return;

      // Find student record
      const { data: student } = await supabase
        .from("students")
        .select("id")
        .eq("profile_user_id", user.id)
        .maybeSingle();

      if (!student) {
        setLoading(false);
        return;
      }

      const startOfMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01T00:00:00`;
      const endOfMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${daysInMonth}T23:59:59`;

      const { data: attendances } = await supabase
        .from("attendances")
        .select("checked_in_at")
        .eq("student_id", student.id)
        .gte("checked_in_at", startOfMonth)
        .lte("checked_in_at", endOfMonth);

      if (attendances) {
        const daySet = new Set(attendances.map((a) => new Date(a.checked_in_at).getDate()));
        setTrainedDays(daySet);
      }
      setLoading(false);
    };
    void loadAttendances();
  }, [user, currentMonth, currentYear, daysInMonth]);

  const startScanner = async () => {
    setScanning(true);
    // Dynamic import to avoid SSR issues
    const { Html5Qrcode } = await import("html5-qrcode");

    setTimeout(async () => {
      if (!scannerRef.current) return;
      const scanner = new Html5Qrcode("qr-reader");
      html5QrCodeRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            await scanner.stop();
            html5QrCodeRef.current = null;
            setScanning(false);
            await handleQrResult(decodedText);
          },
          () => {} // ignore errors during scanning
        );
      } catch (err) {
        toast({ title: "Erro ao abrir câmera", description: "Permita o acesso à câmera.", variant: "destructive" });
        setScanning(false);
      }
    }, 100);
  };

  const stopScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
      } catch {
        // Scanner may already be stopped
      }
      html5QrCodeRef.current = null;
    }
    setScanning(false);
  };

  const handleQrResult = async (text: string) => {
    setSubmitting(true);
    try {
      // Parse token from QR
      let token: string;
      try {
        const parsed = JSON.parse(text);
        token = parsed.token;
      } catch {
        token = text;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Erro", description: "Faça login novamente.", variant: "destructive" });
        setSubmitting(false);
        return;
      }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/record-attendance`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ token }),
        }
      );

      const result = await res.json();
      if (res.ok) {
        toast({ title: "Presença registrada! 💪🥋", description: "Tmj! Oss 👊🏽" });
        // Reload attendances
        setTrainedDays((prev) => new Set([...prev, today.getDate()]));
      } else {
        toast({
          title: result.already_checked_in ? "Presença já registrada hoje" : "Erro",
          description: result.error,
          variant: result.already_checked_in ? "default" : "destructive",
        });
      }
    } catch {
      toast({ title: "Erro", description: "Não foi possível registrar a presença.", variant: "destructive" });
    }
    setSubmitting(false);
  };

  const totalTreinos = trainedDays.size;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">MINHA PRESENÇA</h1>

      {/* QR Scan Button */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {scanning ? (
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <p className="font-display font-bold text-foreground">Escaneie o QR Code do professor</p>
              <Button variant="ghost" size="icon" onClick={stopScanner}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div id="qr-reader" ref={scannerRef} className="w-full max-w-sm mx-auto rounded-lg overflow-hidden" />
          </div>
        ) : (
          <Button
            onClick={startScanner}
            disabled={submitting}
            className="w-full h-16 text-lg font-display font-bold gradient-primary shadow-glow"
          >
            <QrCode className="h-6 w-6 mr-2" />
            {submitting ? "Registrando..." : "Marcar Presença com QR Code"}
          </Button>
        )}
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-border bg-card p-5 shadow-card text-center"
      >
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Treinos no Mês</p>
        <p className="text-4xl font-display font-bold text-primary mt-2">{loading ? "..." : totalTreinos}</p>
      </motion.div>

      {/* Calendar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-border bg-card p-5 shadow-card"
      >
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">
            CALENDÁRIO — {today.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).toUpperCase()}
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
            const trained = trainedDays.has(day);
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
  );
};

export default MinhaPresenca;
