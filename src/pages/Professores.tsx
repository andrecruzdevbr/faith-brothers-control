import { useState } from "react";
import { motion } from "framer-motion";
import { UserPlus, Phone, Shield, GraduationCap, Loader2, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useStaffProfiles } from "@/hooks/useQueries";
import { supabase } from "@/integrations/supabase/client";
import { formatWhatsapp, normalizeWhatsapp } from "@/lib/whatsapp-auth";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  professor: "Professor",
};

const ProfessoresSkeleton = () => (
  <div className="space-y-6">
    <Skeleton className="h-10 w-56" />
    <Skeleton className="h-48 rounded-xl" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  </div>
);

const Professores = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: staff, isLoading, isError, error } = useStaffProfiles();

  const [whatsapp, setWhatsapp] = useState("");
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState<{ admin: boolean; professor: boolean }>({
    admin: false,
    professor: true,
  });
  const [saving, setSaving] = useState(false);

  const toggleRole = (role: "admin" | "professor", checked: boolean) => {
    setRoles((prev) => ({ ...prev, [role]: checked }));
  };

  const handleAssignRoles = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleaned = normalizeWhatsapp(whatsapp);
    if (cleaned.length < 10 || cleaned.length > 11) {
      toast({
        title: "WhatsApp inválido",
        description: "Digite DDD + número (ex: 31999999999).",
        variant: "destructive",
      });
      return;
    }

    if (!fullName.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }

    const selectedRoles: ("admin" | "professor")[] = [];
    if (roles.admin) selectedRoles.push("admin");
    if (roles.professor) selectedRoles.push("professor");

    if (selectedRoles.length === 0) {
      toast({
        title: "Selecione ao menos um papel",
        description: "Marque Administrador e/ou Professor.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc("manage_staff_member", {
        _whatsapp: cleaned,
        _full_name: fullName.trim(),
        _roles: selectedRoles,
      });

      if (rpcError) throw rpcError;

      toast({
        title: "Membro atualizado",
        description: `${fullName.trim()} recebeu os papéis selecionados.`,
      });

      setWhatsapp("");
      setFullName("");
      setRoles({ admin: false, professor: true });
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
    } catch (err) {
      toast({
        title: "Erro ao atribuir papéis",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <ProfessoresSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">PROFESSORES</h1>
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error instanceof Error ? error.message : "Erro ao carregar equipe."}</p>
        </div>
      </div>
    );
  }

  const membros = staff ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">PROFESSORES</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {membros.length} {membros.length === 1 ? "membro da equipe" : "membros da equipe"}
        </p>
      </div>

      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={handleAssignRoles}
        className="rounded-xl border border-border bg-card p-6 shadow-card space-y-4"
      >
        <div className="flex items-center gap-3">
          <UserPlus className="h-6 w-6 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">ATRIBUIR PAPÉIS</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          O membro precisa ter conta criada com o WhatsApp informado antes de receber papéis de equipe.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="staff-whatsapp">WhatsApp</Label>
            <Input
              id="staff-whatsapp"
              placeholder="31999999999"
              inputMode="numeric"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-name">Nome completo</Label>
            <Input
              id="staff-name"
              placeholder="Nome do professor"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={roles.professor}
              onCheckedChange={(v) => toggleRole("professor", v === true)}
            />
            <span className="text-sm text-foreground">Professor</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={roles.admin}
              onCheckedChange={(v) => toggleRole("admin", v === true)}
            />
            <span className="text-sm text-foreground">Administrador</span>
          </label>
        </div>

        <Button type="submit" disabled={saving} className="gradient-primary text-primary-foreground gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
          {saving ? "Salvando..." : "Atribuir papéis"}
        </Button>
      </motion.form>

      {membros.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <GraduationCap className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Nenhum professor ou administrador cadastrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {membros.map((p, i) => (
            <motion.div
              key={p.user_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="rounded-xl border border-primary/30 bg-card p-6 shadow-card shadow-glow"
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center text-xl font-bold text-primary-foreground shrink-0">
                  {p.full_name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-xl font-bold text-foreground truncate">{p.full_name}</h3>
                  {p.whatsapp && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      {formatWhatsapp(p.whatsapp)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.roles.map((role) => (
                      <Badge key={role} variant={role === "admin" ? "default" : "secondary"}>
                        {ROLE_LABELS[role] ?? role}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Professores;
