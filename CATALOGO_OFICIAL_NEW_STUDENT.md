# Catálogo oficial NEW_STUDENT

Data da auditoria: 2026-08-09  
Escopo: implementação **local** (migration aditiva criada; **não** aplicada em produção).

## Auditoria produção (antes)

| Modalidade | Frequência | Valor oficial | Existe antes? | Audience | Ação |
|------------|------------|---------------|---------------|----------|------|
| Mensal | 1 dia | R$ 180 | **NÃO** | — | **CRIAR** |
| Mensal | 2 dias | R$ 210 | SIM (`12b559d9-…`) | new_student | **PRESERVAR / upsert preços** |
| Mensal | 3 dias | R$ 230 | SIM (`9c11ec1d-…`) | new_student | **PRESERVAR / upsert preços** |
| Mensal | 5 dias | R$ 250 | SIM (`c2416e80-…`) | new_student | **PRESERVAR / upsert preços** |
| Trimestral | 1 dia | R$ 480 | NÃO | — | **CRIAR** |
| Trimestral | 2 dias | R$ 540 | NÃO | — | **CRIAR** |
| Trimestral | 3 dias | R$ 630 | NÃO | — | **CRIAR** |
| Trimestral | 5 dias | R$ 690 | NÃO | — | **CRIAR** |
| Semestral | 1 dia | R$ 990 | NÃO | — | **CRIAR** |
| Semestral | 2 dias | R$ 1.155 | NÃO | — | **CRIAR** |
| Semestral | 3 dias | R$ 1.260 | NÃO | — | **CRIAR** |
| Semestral | 5 dias | R$ 1.350 | NÃO | — | **CRIAR** |
| Anual | 1 dia | R$ 1.980 | NÃO | — | **CRIAR** |
| Anual | 2 dias | R$ 2.310 | NÃO | — | **CRIAR** |
| Anual | 3 dias | R$ 2.500 | NÃO | — | **CRIAR** |
| Anual | 5 dias | R$ 2.750 | NÃO | — | **CRIAR** |

**Total:** 3 existentes corretos + 13 a criar = **16** combinações.

## Estado VETERAN (não alterado com preços new_student)

Seeds existentes (sem alunos vinculados):

| Nome | Valor seed | Ação na migration local |
|------|------------|-------------------------|
| Pacote Semestral Veterano 2/3/5 | 720 / 900 / 1080 | `active=false` (não são preços oficiais do cliente) |
| Pacote Anual Veterano 2/3/5 | 1440 / 1800 / 2160 | `active=false` |
| Treino avulso veterano | 45 | `active=false` |

Mensal/trimestral veterano: **não existem** — estrutura pronta via `PlanCatalogManager` (Financeiro).  
Mensagem ADM: **“Valores dos planos veteranos ainda não configurados.”**

## Migration

`supabase/migrations/20260809140000_official_new_student_catalog.sql`

- Upsert 16 planos `audience=new_student`
- Mensal → `asaas_monthly`; Tri/Sem/Anual → `machine_prepaid` (3/6/12 meses)
- Frequência veterano `requested_training_days` ∈ {1,2,3,5}
- `get_public_active_plans('new_student')` inclui pacotes prepaid
- `set_veteran_billing_period` **nunca** usa preço new_student
- Desativa seeds veterano não oficiais

**Não aplicada em produção** nesta etapa.

## UI / regras

- Novo: grade MENSAL / TRIMESTRAL / SEMESTRAL / ANUAL com preços **do banco**
- Veterano: só frequência 1/2/3/5 — sem plano/pagamento
- Faixa sim, graus não
- WhatsApp aprovação preservado (Novo / Veterano / Familiar responsável)

## Go-live (2026-08-09)

**APLICADO em produção** via `npx supabase db push`  
Migration: `20260809140000_official_new_student_catalog.sql`

Pós-check: **16** planos `new_student` ativos com valores oficiais; seeds veteran desativados; família intocada.

Ver detalhes em `GO_LIVE_CATALOGO_NEW_STUDENT.md`.
