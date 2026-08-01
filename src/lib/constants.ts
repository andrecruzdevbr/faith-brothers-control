export type AppRole = "admin" | "professor" | "aluno" | "academy_limited";

/** Rotas exclusivas de admin (exceto Configurações, que limited também acessa em modo básico). */
export const ADMIN_ONLY_PATHS = ["/financeiro", "/professores", "/configuracoes"] as const;

/** Rotas operacionais permitidas para academy_limited (+ staff). */
export const ACADEMY_LIMITED_PATHS = [
  "/turmas",
  "/presencas",
  "/graduacao",
  "/ranking",
  "/configuracoes",
] as const;

/** Rotas de staff completo (admin/professor), sem academy_limited. */
export const STAFF_FULL_PATHS = [
  "/dashboard",
  "/alunos",
  "/relatorios",
] as const;

export const STAFF_PATHS = [
  ...STAFF_FULL_PATHS,
  "/turmas",
  "/presencas",
  "/graduacao",
  "/ranking",
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
