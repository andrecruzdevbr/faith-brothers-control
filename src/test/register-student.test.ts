import { describe, it, expect } from "vitest";
import { mapRegisterStudentRpcError } from "../../supabase/functions/_shared/register-errors.ts";

describe("mapRegisterStudentRpcError", () => {
  it("maps duplicate CPF/CNPJ before WhatsApp", () => {
    expect(mapRegisterStudentRpcError("Este CPF/CNPJ já está cadastrado.")).toEqual({
      status: 409,
      error: "Este CPF/CNPJ já está cadastrado.",
    });
    expect(mapRegisterStudentRpcError("Este CPF/CNPJ já está cadastrado para outro aluno.")).toEqual({
      status: 409,
      error: "Este CPF/CNPJ já está cadastrado.",
    });
  });

  it("maps duplicate WhatsApp separately", () => {
    expect(mapRegisterStudentRpcError("Este WhatsApp já está cadastrado.")).toEqual({
      status: 409,
      error: "Este WhatsApp já está cadastrado.",
    });
  });

  it("does not map CPF duplicate as WhatsApp", () => {
    const result = mapRegisterStudentRpcError("Este CPF/CNPJ já está cadastrado.");
    expect(result.error).not.toContain("WhatsApp");
  });

  it("redacts document numbers from generic errors", () => {
    const result = mapRegisterStudentRpcError("Falha ao validar 52998224725 no serviço");
    expect(result.status).toBe(500);
    expect(result.error).not.toContain("52998224725");
    expect(result.error).toContain("[documento]");
  });
});
