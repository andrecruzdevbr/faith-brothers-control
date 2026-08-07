import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { User, Phone, ShieldCheck, Building2, Lock, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatWhatsapp } from "@/lib/whatsapp-auth";
import { StudentBillingTaxIdEditor } from "@/components/StudentBillingTaxIdEditor";
import { StudentContractOverview } from "@/components/StudentContractOverview";

const MeuPerfil = () => {
  const { user, isAluno } = useAuth();
  const { toast } = useToast();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!isAluno || !user?.id) return;
    void supabase
      .from("students")
      .select("id")
      .eq("profile_user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setStudentId(data?.id ?? null));
  }, [isAluno, user?.id]);

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast({ title: "A nova senha precisa ter pelo menos 8 caracteres", variant: "destructive" });
      return;
    }
    if (!currentPassword) {
      toast({ title: "Informe sua senha atual", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "As senhas não conferem", variant: "destructive" });
      return;
    }

    setChangingPassword(true);

    const email = user?.email;
    if (email) {
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (verifyError) {
        toast({ title: "Senha atual incorreta", variant: "destructive" });
        setChangingPassword(false);
        return;
      }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast({ title: "Erro ao alterar senha", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Senha alterada com sucesso!" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setChangingPassword(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">MEU PERFIL</h1>
        <p className="mt-1 text-sm text-muted-foreground">Seus dados de acesso e vínculo na plataforma.</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full gradient-primary text-xl font-bold text-primary-foreground">
            {user?.nome
              ?.split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2) ?? "UP"}
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold text-foreground">{user?.nome}</h2>
            <p className="text-sm text-muted-foreground">Área pessoal</p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><User className="h-4 w-4 text-primary" /> Nome</div>
            <p className="mt-2 font-medium text-foreground">{user?.nome ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Phone className="h-4 w-4 text-primary" /> WhatsApp</div>
            <p className="mt-2 font-medium text-foreground">{user?.whatsapp ? formatWhatsapp(user.whatsapp) : "—"}</p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> Tipo de usuário</div>
            <p className="mt-2 font-medium uppercase tracking-wide text-foreground">{user?.roles.join(" · ") ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Building2 className="h-4 w-4 text-primary" /> Academia</div>
            <p className="mt-2 font-medium text-foreground">Faith Brothers BJJ</p>
          </div>
        </div>
      </motion.div>

      {isAluno && studentId && (
        <>
          <StudentContractOverview studentId={studentId} />
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="rounded-xl border border-border bg-card p-6 shadow-card"
          >
            <h3 className="font-display text-lg font-bold tracking-wider mb-4">DADOS DE COBRANÇA</h3>
            <StudentBillingTaxIdEditor studentId={studentId} />
          </motion.div>
        </>
      )}

      {/* Change password */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="flex items-center gap-2 mb-4">
          <Lock className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">ALTERAR SENHA</h3>
        </div>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="text-sm text-muted-foreground">Senha atual</label>
            <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Nova senha</label>
            <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Confirmar nova senha</label>
            <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <Button onClick={handleChangePassword} disabled={changingPassword || !newPassword}>
            <Save className="h-4 w-4" />
            {changingPassword ? "Alterando..." : "Salvar nova senha"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default MeuPerfil;
