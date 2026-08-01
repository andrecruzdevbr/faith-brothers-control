import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  formatAgeDisplay,
  isMinor,
  validateStudentBirthFields,
} from "@/lib/student-age";

type StudentBirthEditorProps = {
  studentId: string;
  studentName: string;
  birthDate?: string | null;
  guardianName?: string | null;
  onSaved?: () => void;
};

export function StudentBirthEditor({
  studentId,
  studentName,
  birthDate = null,
  guardianName = null,
  onSaved,
}: StudentBirthEditorProps) {
  const { toast } = useToast();
  const [birth, setBirth] = useState(birthDate?.slice(0, 10) ?? "");
  const [guardian, setGuardian] = useState(guardianName ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBirth(birthDate?.slice(0, 10) ?? "");
    setGuardian(guardianName ?? "");
  }, [birthDate, guardianName]);

  const guardianRequired = !!birth && isMinor(birth);

  const handleSave = async () => {
    const error = validateStudentBirthFields({
      birthDate: birth,
      guardianName: guardian,
    });
    if (error) {
      toast({ title: "Dados incompletos", description: error, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("students")
        .update({
          birth_date: birth,
          guardian_name: guardian.trim() || null,
        })
        .eq("id", studentId);

      if (updateError) throw updateError;

      toast({
        title: "Dados atualizados",
        description: `Nascimento/responsável de ${studentName} salvos.`,
      });
      onSaved?.();
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="birth_date">Data de nascimento</Label>
        <Input
          id="birth_date"
          type="date"
          value={birth}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBirth(e.target.value)}
        />
        {birth ? (
          <p className="text-xs text-muted-foreground">Idade: {formatAgeDisplay(birth)}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="guardian_name">
          Nome do responsável{guardianRequired ? " *" : " (opcional se maior de idade)"}
        </Label>
        <Input
          id="guardian_name"
          value={guardian}
          placeholder={guardianRequired ? "Obrigatório para menores" : "Opcional"}
          onChange={(e) => setGuardian(e.target.value)}
        />
      </div>
      <Button
        className="gradient-primary text-primary-foreground w-full"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
      </Button>
    </div>
  );
}
