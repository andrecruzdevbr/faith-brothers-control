import { useCallback, useEffect, useState } from "react";
import { Loader2, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { isValidTaxId, normalizeTaxId } from "@/lib/tax-id";

type MaskedRow = { masked: string | null; has_tax_id: boolean };

type StudentBillingTaxIdEditorProps = {
  studentId: string;
  onSaved?: () => void;
};

export function StudentBillingTaxIdEditor({ studentId, onSaved }: StudentBillingTaxIdEditorProps) {
  const { toast } = useToast();
  const [masked, setMasked] = useState<string | null>(null);
  const [hasTaxId, setHasTaxId] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadMasked = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_student_billing_tax_id_masked", {
      _student_id: studentId,
    });
    if (error) {
      toast({ title: "Erro ao carregar dados financeiros", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as MaskedRow | undefined;
    setMasked(row?.masked ?? null);
    setHasTaxId(!!row?.has_tax_id);
    setLoading(false);
  }, [studentId, toast]);

  useEffect(() => {
    void loadMasked();
  }, [loadMasked]);

  const handleSave = async () => {
    const clean = normalizeTaxId(input);
    if (!isValidTaxId(clean)) {
      toast({
        title: "CPF ou CNPJ inválido",
        description: "Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc("upsert_student_billing_tax_id", {
      _student_id: studentId,
      _tax_id: clean,
    });

    if (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "CPF/CNPJ de cobrança atualizado" });
      setInput("");
      await loadMasked();
      onSaved?.();
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-4 w-4 text-primary" />
          Dado financeiro restrito
        </div>
        <p className="mt-2 text-sm text-foreground">
          {hasTaxId ? `Cadastrado: ${masked}` : "Nenhum CPF/CNPJ de cobrança cadastrado."}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor={`tax-id-${studentId}`}>
          {hasTaxId ? "Atualizar CPF/CNPJ" : "Informar CPF/CNPJ"}
        </label>
        <Input
          id={`tax-id-${studentId}`}
          inputMode="numeric"
          placeholder="Somente números"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 14))}
        />
        <p className="text-xs text-muted-foreground">O número completo não é exibido após salvar.</p>
      </div>

      <Button type="button" onClick={() => void handleSave()} disabled={saving || !input}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {saving ? "Salvando..." : "Salvar CPF/CNPJ"}
      </Button>
    </div>
  );
}
