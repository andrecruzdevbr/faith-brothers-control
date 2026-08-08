# Atualização — Turmas e Horários (agenda oficial)

**Data:** 2026-08-08  
**Escopo:** implementação + go-live controlado (migration aplicada em produção)

---

## Estrutura encontrada

| Item | Situação prévia |
|------|-----------------|
| Tabela | `public.classes` (nome + `schedule_days`/`schedule_time` texto livre) |
| Modalidade por dia | **Não suportada** |
| UI ADM | `/turmas` somente leitura |
| ADM restrito (`academy_limited`) | via `/turmas` (home), sem CRUD |
| Cadastro público | sem agenda |
| Aluno | sem menu de turmas |
| Hardcodes frontend | nenhum array de horários (só seed SQL legado) |

---

## Alterações realizadas

### Migration (nova, aditiva) — APLICADA
`supabase/migrations/20260808120000_official_class_schedules.sql`

- Colunas: `day_of_week`, `start_time`, `audience`, `level`, `modality`, `notes`, `sort_order`
- Soft-desativa linhas legadas sem dia/hora
- Seed idempotente `official_v1` com **23** slots oficiais
- RPC `get_public_class_schedules` (anon/authenticated, somente ativos)
- RLS write: `is_admin_only` **ou** `is_academy_limited_of` (ops de agenda; sem financeiro)

### Frontend (fonte única)
- `src/lib/class-schedules.ts` — labels, filtros, agrupamento, expectativas oficiais
- `src/components/ClassScheduleBoard.tsx` — board mobile-first compartilhado
- `src/pages/Turmas.tsx` — agenda + CRUD para admin/academy_limited
- `src/pages/MinhasTurmas.tsx` — aluno (leitura)
- `src/pages/Cadastro.tsx` + `FamilyRegistrationWizard` — leitura via RPC
- `useClasses` / `usePublicClassSchedules` — sem fallback para `plans`
- Sidebar aluno: **Turmas e Horários** → `/minhas-turmas`

---

## Horários inseridos (resumo)

- Seg/Qua/Sex: 17:40 e 18:45 Infantil (GI); 19:45 Adulto (**Qua NOGI**); 21:15 Adulto GI
- Ter/Qui/Sex: 10:00 Adulto (**Qui NOGI**)
- Ter/Qui: 13:30, 17:00, 19:00 Adulto GI; 18:00 Feminino GI

---

## Go-live

Ver `GO_LIVE_TURMAS_HORARIOS.md`.


---

## Estrutura encontrada

| Item | Situação prévia |
|------|-----------------|
| Tabela | `public.classes` (nome + `schedule_days`/`schedule_time` texto livre) |
| Modalidade por dia | **Não suportada** |
| UI ADM | `/turmas` somente leitura |
| ADM restrito (`academy_limited`) | via `/turmas` (home), sem CRUD |
| Cadastro público | sem agenda |
| Aluno | sem menu de turmas |
| Hardcodes frontend | nenhum array de horários (só seed SQL legado) |

---

## Alterações realizadas

### Migration (nova, aditiva)
`supabase/migrations/20260808120000_official_class_schedules.sql`

- Colunas: `day_of_week`, `start_time`, `audience`, `level`, `modality`, `notes`, `sort_order`
- Soft-desativa linhas legadas sem dia/hora
- Seed idempotente `official_v1` com **23** slots oficiais
- RPC `get_public_class_schedules` (anon/authenticated, somente ativos)
- RLS write: `is_admin_only` **ou** `is_academy_limited_of` (ops de agenda; sem financeiro)

### Frontend (fonte única)
- `src/lib/class-schedules.ts` — labels, filtros, agrupamento, expectativas oficiais
- `src/components/ClassScheduleBoard.tsx` — board mobile-first compartilhado
- `src/pages/Turmas.tsx` — agenda + CRUD para admin/academy_limited
- `src/pages/MinhasTurmas.tsx` — aluno (leitura)
- `src/pages/Cadastro.tsx` + `FamilyRegistrationWizard` — leitura via RPC
- `useClasses` / `usePublicClassSchedules` — sem fallback para `plans`
- Sidebar aluno: **Turmas e Horários** → `/minhas-turmas`

---

## Horários inseridos (resumo)

- Seg/Qua/Sex: 17:40 e 18:45 Infantil (GI); 19:45 Adulto (**Qua NOGI**); 21:15 Adulto GI
- Ter/Qui/Sex: 10:00 Adulto (**Qui NOGI**)
- Ter/Qui: 13:30, 17:00, 19:00 Adulto GI; 18:00 Feminino GI

---

## RLS

| Papel | SELECT ativos | CRUD agenda |
|-------|---------------|-------------|
| admin | sim | sim |
| academy_limited | sim | sim (somente `classes`) |
| professor / aluno | sim (própria academia) | não |
| anon (cadastro) | via RPC públicos ativos | não |

Financeiro / prepaid / Asaas / WhatsApp **não** alterados.

---

## Testes

- Unit: `src/test/class-schedules.test.ts` (23 slots + NOGI Quarta 19:45 / Quinta 10:00)
- `npm test` / `npm run build` / `npm run lint` (executados na sessão)

---

## Riscos

1. Migration **ainda não aplicada em produção** — UI nova espera colunas/RPC.
2. Contas `academy_limited` passam a poder editar agenda (intencional/ops); sem acesso financeiro.
3. Linhas legadas ficam `active=false` (preservadas, fora da agenda oficial).

---

## Go-live (aguardando autorização)

1. Apply migration em produção  
2. Deploy frontend  
3. Validar `/cadastro`, `/turmas`, `/minhas-turmas`
