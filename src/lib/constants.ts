export type AppRole = "admin" | "professor" | "aluno";

export const ADMIN_ONLY_PATHS = ["/financeiro", "/professores", "/configuracoes"] as const;

export const STAFF_PATHS = [
  "/dashboard",
  "/alunos",
  "/turmas",
  "/presencas",
  "/graduacao",
  "/ranking",
  "/relatorios",
  ...ADMIN_ONLY_PATHS,
] as const;

export const BILLING_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  gerado: "Gerado",
  enviado_whatsapp: "Enviado",
  pago: "Pago",
  vencido: "Vencido",
  cancelado: "Cancelado",
  falhou: "Falhou",
};

export const STUDENT_STATUS_LABELS: Record<string, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  pendente_aprovacao: "Pendente",
  rejeitado: "Rejeitado",
};

export const BELTS = ["Branca", "Cinza", "Amarela", "Laranja", "Verde", "Azul", "Roxa", "Marrom", "Preta"] as const;

export const PAGE_SIZE = 20;
