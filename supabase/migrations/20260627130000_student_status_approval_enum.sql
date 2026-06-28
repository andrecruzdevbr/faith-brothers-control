-- student_status: valores do fluxo de aprovação de cadastro de aluno
-- Idempotente — seguro reexecutar em ambientes que já possuem os valores.

ALTER TYPE public.student_status ADD VALUE IF NOT EXISTS 'pendente_aprovacao';
ALTER TYPE public.student_status ADD VALUE IF NOT EXISTS 'rejeitado';
