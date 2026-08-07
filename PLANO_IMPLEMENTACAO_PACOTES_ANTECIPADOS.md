# PLANO DE IMPLEMENTAÇÃO — Pacotes pagos antecipadamente + Plano familiar

**Projeto:** Faith Brothers Control  
**Data:** 2026-08-06 (atualizado 2026-08-07)  
**Fase:** 4 — Go-live controlado (migrations + flags Faith Brothers)  
**Status:** produção atualizada; flags ON só Faith Brothers; **sem** 1º pagamento real autorizado  

---

## Decisões aprovadas (§13)

1. **Mês corrente inteiro** se início no meio do mês — SIM (V1). Admin escolhe `starts_on`; o mês civil dessa data é o 1º coberto. Informar na tela de aprovação.
2. **Fim do pacote / Asaas** — NÃO cobrar automaticamente. Contrato `expirado`; admin renova ou migra para mensal.
3. **Avulso** — SIM: só pagamento; sem meses futuros; fora do cron; R$ 45; maquininha/outra forma.
4. **Quem confirma** — SOMENTE admin. Staff não confirma/libera/altera valor/cancela/estorna. Audit: `approved_by`, `approved_at`, IP/meta em `confirmation_meta`, histórico em `contract_payments`.
5. **Feature flags** — `prepaid_contracts_enabled` / `family_plans_enabled` default **false** em `academy_billing_settings`.
6. **Formas V1** — crédito (parcelas), débito, Pix, dinheiro. Não-crédito ⇒ `installments = 1`; pagamento aprovado libera todo o período.

**Plano familiar:** mesma arquitetura; XOR `student_id` / `family_group_id`; vínculo por IDs (não CPF entre alunos); cron `skipped_family_contract_covered`.

## 1. Resumo executivo

Hoje o sistema é **mensalidade recorrente via Asaas**:

1. aluno se cadastra → `pendente_aprovacao` + `plan_id` mensal;  
2. admin aprova → `ativo` (sem pagamento);  
3. cron do dia 10 gera boleto Asaas por `reference_month`.

Não existem contratos, cobertura de meses, parcelamento de maquininha nem vínculo aprovação↔pagamento.

O novo fluxo introduz **pacotes antecipados** (ex.: semestral veterano): o aluno escolhe plano + forma de pagamento + parcelas desejadas; o admin confirma o pagamento na maquininha e o sistema **libera imediatamente todos os meses cobertos**, sem gerar boletos Asaas nesses meses. Parcelas do cartão são **apenas metadado da venda**.

---

## 2. Auditoria do estado atual

### 2.1 Tabelas relevantes

| Tabela | Papel hoje | Lacuna para pacotes |
|--------|------------|---------------------|
| `plans` | `name`, `monthly_price`, `training_days_per_week`, `active` | Sem duração, categoria, total do pacote, parcelamento |
| `students` | `plan_id`, `status` | Sem contrato ativo / flag prepaid |
| `billings` | Cobrança mensal Asaas; UNIQUE `(student_id, reference_month)` | Não modela “mês pago por pacote” sem boleto |
| `student_billing_profiles` | CPF/CNPJ | Sem mudança obrigatória |
| `student_plan_change_requests` | Troca de plano | Não cobre prepaid |

**Enums:**  
- `student_status`: `ativo` \| `inativo` \| `pendente_aprovacao` \| `rejeitado`  
- `billing_status`: `pendente` \| `gerado` \| `enviado_whatsapp` \| `pago` \| `vencido` \| `cancelado` \| `falhou`

**Contratos / cobertura:** inexistentes.

### 2.2 Aprovação do aluno

- RPC `approve_student(_student_id, _approve)` — só troca status.  
- UI: `Alunos.tsx` (admin).  
- **Não** cria billing, **não** chama Asaas, **não** envia WhatsApp.

### 2.3 Cadastro público

- `Cadastro.tsx` → `get_public_active_plans` → escolhe `plan_id`.  
- Edge `register-student` → RPC `complete_student_registration_atomic` → status `pendente_aprovacao`.  
- Campos atuais: nome, WhatsApp, senha, academia, faixa, CPF, plano, nascimento, responsável.  
- **Não** coleta forma de pagamento nem parcelas.

### 2.4 Inadimplência e acesso

- View `student_financial_overview` = último billing.  
- Badge “Atrasado / Em dia” é **informativo**.  
- **Presença / rotas não bloqueiam por billing** (só `status = ativo`).

### 2.5 Cron mensal (`generate-monthly-billings`)

Elegíveis: `status = 'ativo'` + `plan_id NOT NULL` (+ CPF, WhatsApp, issue day).

Skips atuais: plano/settings ausentes, antes do dia 10, sem WhatsApp, sem CPF, `already_exists`, falhas Asaas.

**Não** há skip por “mês coberto por pacote pago”.

### 2.6 Planos existentes (preservar)

| Nome | Preço | Dias/semana |
|------|-------|-------------|
| Plano 2 dias por semana | 210 | 2 |
| Plano 3 dias por semana | 230 | 3 |
| Plano 5 dias por semana | 250 | 5 |

### 2.7 WhatsApp

- Cadastro: tipo `registration` (boas-vindas / aguardar aprovação).  
- Aprovação: **sem** mensagem.  
- Novo fluxo precisará de tipo idempotente (ex.: `contract_approved`).

---

## 3. Modelo de domínio proposto

### 3.1 Conceitos

| Conceito | Significado |
|----------|-------------|
| **Plano mensal** | Recorrência Asaas (comportamento atual) |
| **Pacote antecipado** | Pagamento único na academia; N meses liberados de uma vez |
| **Parcelas** | Info da maquininha; **não** controla cobertura mensal |
| **Mês coberto** | Direito de acesso/treino naquele `reference_month` |
| **Contrato** | Vínculo aluno↔pacote com início/fim e status |

### 3.2 Regra de ouro (produto)

> Confirmar pagamento do pacote ⇒ criar **imediatamente** todos os `student_contract_months` como `pago`.  
> O cron Asaas **pula** qualquer aluno cujo `reference_month` do lote esteja coberto como `pago` por contrato ativo.

---

## 4. Banco de dados proposto

### 4.1 Extensão de `plans`

Colunas novas (nullable onde legado mensal não precisa):

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `category` | text | ex.: `veterano`, `normal`, `familia` |
| `audience` | text | `normal` \| `veterano` \| `familia` \| `outro` |
| `plan_kind` | text | `mensal` \| `trimestral` \| `semestral` \| `anual` \| `avulso` |
| `duration_months` | int | 0 = avulso; 1 = mensal; 6 = semestral… |
| `reference_monthly_price` | numeric | valor mensal de referência (pode = `monthly_price`) |
| `package_total_amount` | numeric | total do pacote (null se mensal) |
| `billing_mode` | text | `asaas_monthly` \| `machine_prepaid` \| `machine_dropin` |
| `allows_installments` | boolean | default false |
| `max_installments` | int | ex.: 6 |
| `description` | text | opcional |

Compatibilidade: planos atuais ficam `plan_kind='mensal'`, `billing_mode='asaas_monthly'`, `duration_months=1`, `package_total_amount=null`.

Seed veteranos (academy atual):

| Nome | Dias | Mensal ref. | Total | Duração | Kind |
|------|------|-------------|-------|---------|------|
| Pacote Semestral Veterano 5 dias | 5 | 180 | 1080 | 6 | semestral |
| Pacote Semestral Veterano 3 dias | 3 | 150 | 900 | 6 | semestral |
| Pacote Semestral Veterano 2 dias | 2 | 120 | 720 | 6 | semestral |
| Treino avulso veterano | 1 | 45 | 45 | 0 | avulso |

`billing_mode`: semestrais = `machine_prepaid`; avulso = `machine_dropin`.

### 4.2 Novas tabelas

#### `student_contracts`

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | |
| `academy_id` | uuid NOT NULL | |
| `student_id` | uuid NOT NULL | FK students |
| `plan_id` | uuid NOT NULL | FK plans |
| `starts_on` | date NOT NULL | 1º dia civil da cobertura (ver §5) |
| `ends_on` | date NOT NULL | inclusive último dia do último mês |
| `duration_months` | int NOT NULL | |
| `weekly_frequency` | int | snapshot |
| `reference_monthly_amount` | numeric | snapshot |
| `total_amount` | numeric NOT NULL | snapshot |
| `payment_method` | text | `cartao_credito` \| `pix` \| `dinheiro` \| `outro` |
| `installments` | int | ≥1; info maquininha |
| `payment_status` | text | `aguardando` \| `pago` \| `cancelado` \| `estornado` |
| `contract_status` | text | `rascunho` \| `ativo` \| `encerrado` \| `cancelado` |
| `registration_notes` | text | opcional |
| `approved_at` / `approved_by` | timestamptz / uuid | admin Auth |
| `payment_confirmed_at` / `payment_confirmed_by` | | |
| `created_at` / `updated_at` | | |

**Constraints:**  
- CHECK `installments >= 1`  
- CHECK `ends_on >= starts_on`  
- Índice parcial: no máximo **um** contrato `contract_status='ativo'` **e** `payment_status='pago'` por aluno (ou regra de não overlap de meses — ver riscos).

#### `student_contract_months`

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | |
| `contract_id` | uuid NOT NULL | |
| `student_id` | uuid NOT NULL | denormalizado p/ cron |
| `academy_id` | uuid NOT NULL | |
| `reference_month` | date NOT NULL | sempre dia 1 |
| `status` | text | `pago` \| `pendente` \| `cancelado` \| `estornado` \| `vencido` |
| `paid_at` | timestamptz | |
| `created_at` | | |

**UNIQUE `(contract_id, reference_month)`**  
Índice `(student_id, reference_month, status)` para o cron.

#### `contract_payments` (confirmação / auditoria)

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | |
| `contract_id` | uuid NOT NULL | |
| `amount` | numeric | |
| `payment_method` | text | |
| `installments` | int | |
| `machine_reference` | text | opcional |
| `confirmed_at` / `confirmed_by` | | |
| `notes` | text | |
| `action` | text | `confirm` \| `cancel` \| `refund` |
| `created_at` | | |

Impedir dupla confirmação: UNIQUE parcial em `contract_id` WHERE `action='confirm'` **ou** RPC transacional com lock.

#### Cadastro pendente (opção recomendada)

Campos em `students` **ou** tabela `student_registration_intents`:

| Campo | Uso |
|-------|-----|
| `requested_payment_method` | escolha do aluno |
| `requested_installments` | escolha do aluno |
| `requested_plan_id` | já existe `plan_id` |
| `payment_review_status` | `nao_aplicavel` \| `aguardando_conferencia` \| `confirmado` \| `recusado` |

Para pacotes `machine_*`: ao cadastrar → `pendente_aprovacao` + `payment_review_status='aguardando_conferencia'`.  
Mensais Asaas: `payment_review_status='nao_aplicavel'` (fluxo atual).

### 4.3 RLS

Seguir padrão existente:

- SELECT: `can_access_student(student_id)` (aluno dono ou staff da academia).  
- INSERT/UPDATE sensíveis: **RPC SECURITY DEFINER** admin-only (`is_admin_only` / `is_admin_of_academy`).  
- Professor: ver contratos; **somente admin** confirma pagamento / cancela / estorna (alinhado a `billings` write = admin).

---

## 5. Regra de datas (propor antes de codar)

**Proposta (clara e simples):**

1. Admin informa **data inicial do contrato** (`starts_on`).  
2. O **primeiro `reference_month`** = primeiro dia do mês civil de `starts_on` (America/Sao_Paulo).  
   - Ex.: início 15/08/2026 → meses Ago/2026 … Jan/2027 (6 meses).  
3. Mesmo se começar no meio do mês, **o mês corrente conta como coberto** (academia já recebeu o pacote).  
4. `ends_on` = último dia do último mês de cobertura.

**Avulso (`duration_months=0`):**  
- Sem `student_contract_months` futuros.  
- Registrar `contract_payments` + opcionalmente 1 mês/`reference_month` do dia do treino **ou** só o pagamento avulso sem cobertura mensal — **recomendação:** 1 registro de pagamento + contrato `encerrado` no mesmo dia, sem bloquear cron futuro.

Aguardando confirmação desta regra na aprovação do plano.

---

## 6. Fluxos

### 6.1 Cadastro público (pacote)

1. Aluno escolhe plano (mensal ou pacote) a partir do catálogo ativo.  
2. Se `billing_mode = machine_prepaid`:  
   - forma de pagamento (cartão, pix, dinheiro…);  
   - se cartão e `allows_installments`: parcelas 1..`max_installments`;  
   - UI mostra total, Nx, valor estimado parcela (`total / N`);  
   - texto: “aprovação e confirmação do pagamento pela academia”.  
3. Persistência: student + intent/pagamento solicitado.  
4. Status: `pendente_aprovacao` + `aguardando_conferencia`.  
5. WhatsApp: manter boas-vindas atual (**não** liberar meses).

### 6.2 Admin — “Pagamento aprovado e meses liberados”

RPC única transacional (ex.: `confirm_prepaid_contract_payment`):

1. Validar admin + aluno `pendente_aprovacao` (ou ativo com contrato aguardando — definir).  
2. Lock do aluno/contrato.  
3. Criar/atualizar `student_contracts` (`ativo`, `pago`).  
4. Inserir N linhas em `student_contract_months` (`pago`).  
5. Inserir `contract_payments` (`confirm`).  
6. `students.status = 'ativo'`; alinhar `plan_id`.  
7. `payment_review_status = 'confirmado'`.  
8. Enfileirar WhatsApp `contract_approved` (idempotente por `student_id` + tipo + `contract_id`).  
9. Auditoria (`approved_by`, timestamps).

Botões separados opcionais: rejeitar cadastro; salvar correções de plano/parcelas/data **sem** confirmar pagamento.

### 6.3 Cron Asaas

Antes de criar payment, novo skip:

```
skipped_prepaid_month_covered
```

quando existir `student_contract_months` com  
`student_id` + `reference_month` do período + `status = 'pago'`.

Não remove lógica mensal. Alunos só mensais inalterados.

Após `ends_on`, sem mês coberto → volta ao cron normal **se** ainda `ativo` + plano mensal/`asaas_monthly`.  
**Decisão de produto (abrir):** ao fim do pacote, aluno permanece no plano pacote (sem Asaas) ou admin deve migrar para plano mensal?  
**Recomendação:** ao confirmar pacote, manter `plan_id` do pacote; ao expirar cobertura, cron **não** gera boleto do pacote (`billing_mode != asaas_monthly`); admin renova pacote ou troca para plano mensal Asaas.

### 6.4 Cancelamento / estorno (mínimo)

RPC `cancel_or_refund_prepaid_contract`:

- motivo obrigatório;  
- `contract_status` / `payment_status` atualizados;  
- meses **futuros** → `cancelado` ou `estornado`;  
- meses passados preservados como histórico `pago`;  
- **não** DELETE;  
- não reabre boletos retroativos automaticamente.

---

## 7. Telas e arquivos impactados

| Área | Arquivos prováveis |
|------|-------------------|
| Cadastro | `Cadastro.tsx`, `register-student`, RPC atomic, `get_public_active_plans` |
| Aprovação | `Alunos.tsx` (drawer/modal de pendentes) |
| Perfil aluno | `MeuPerfil.tsx` / novo componente Contrato |
| Admin aluno | `Alunos.tsx` ficha |
| Planos | CRUD/listagem admin se existir; seed migration |
| Financeiro | badge “Pacote pago até …”; filtro |
| Cron | `generate-monthly-billings`, `billing-settings` summary |
| WhatsApp | `_shared/whatsapp-messages.ts`, `registration`/`contract` helpers |
| Tipos | `src/integrations/supabase/types.ts` |
| Testes | `src/test/*` novos |

---

## 8. Edge Functions / RPCs

| Item | Mudança |
|------|---------|
| `register-student` | Aceitar `payment_method`, `installments`; validar contra plano |
| `complete_student_registration_atomic` | Persistir intent / campos novos |
| **Novo** `confirm_prepaid_contract_payment` | Transação admin |
| **Novo** `update_pending_registration_commercial` | Corrigir plano/parcelas/data antes de confirmar |
| **Novo** `cancel_or_refund_prepaid_contract` | Cancel/estorno |
| `generate-monthly-billings` | Skip cobertura prepaid |
| `approve_student` | Mensais: manter; prepaid: **não** ativar sem pagamento **ou** ativar só após confirm RPC (recomendado unificar no botão novo) |

**Recomendação UX:** para pacotes, esconder “Aprovar” simples; só “Pagamento aprovado e meses liberados”. Para mensais Asaas, manter “Aprovar” atual.

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Cobrança Asaas + mês prepaid | Skip no cron + testes |
| Duplo clique no botão | RPC idempotente + UNIQUE payment confirm + UI disabled |
| Dois contratos overlapping | Constraint / validação de overlap de `reference_month` |
| Confundir parcelas com meses | UI: labels distintos; testes de documentação |
| Plano pacote no cron após fim | `billing_mode != asaas_monthly` nunca gera boleto |
| Aluno mensal legado quebrado | Defaults em `plans` + sem mudança no path Asaas |
| WhatsApp duplicado | `message_type=contract_approved` + idempotência por contract_id |
| Avulso gerando 6 meses | `duration_months=0` path separado |

---

## 10. Estratégia de compatibilidade

1. Migration additive (colunas nullable + defaults).  
2. Backfill planos atuais → mensal / Asaas.  
3. Seed pacotes veterano **novos** (não sobrescrever nomes dos planos 210/230/250).  
4. Feature flag opcional `prepaid_packages_enabled` em `academy_billing_settings` (recomendado para rollout).  
5. Zero mudança em produção até aprovação deste plano + migrations revisadas.

---

## 11. Testes planejados (Fase 5)

- Cadastro pacote + cartão + limite de parcelas.  
- Aprovação cria exatamente `duration_months` linhas `pago`.  
- Idempotência da RPC de confirmação.  
- Cron: `skipped_prepaid_month_covered` nos 6 meses; mensal Asaas continua gerando.  
- Após último mês, pacote não gera boleto.  
- Perfil lista meses.  
- Cancelamento revoga futuros.  
- RLS aluno vs admin.  
- WhatsApp único `contract_approved`.  
- `npm test` / `build` / `lint`.

**Ambiente de teste:** sem cobrança Asaas real; `WHATSAPP_SEND_ENABLED=false` ou mock.

---

## 12. Ordem de execução (após aprovação)

| Fase | Conteúdo | Entrega |
|------|----------|---------|
| **1** | Auditoria + este plano | `PLANO_IMPLEMENTACAO_PACOTES_ANTECIPADOS.md` ✅ |
| **2** | Migrations, RLS, RPCs, testes SQL/unitários de domínio | PR review |
| **3** | Cadastro público + aprovação admin + perfil | PR review |
| **4** | Cron skip + WhatsApp aprovação | PR review |
| **5** | Testes E2E/smoke, deploy sob autorização explícita | `IMPLEMENTACAO_PACOTES_ANTECIPADOS.md` |

**Não fazer agora:** commit, push, deploy, alteração em produção, cobrança real, WhatsApp real.

---

## 13. Decisões pendentes (precisam do seu OK)

**TODAS APROVADAS em 2026-08-07** — ver cabeçalho deste documento + complemento plano familiar.

---

## 14. Relatório Fase 2 (local — não aplicado em produção)

### 14.1 Migrations criadas (não pushed)

| Arquivo | Conteúdo |
|---------|----------|
| `supabase/migrations/20260807010000_prepaid_contracts_and_family.sql` | Flags, extensão `plans`, seed veteranos+avulso, intent no `students`, `family_groups`/`family_members`, `student_contracts` (XOR), `contract_members`, `student_contract_months`, `contract_payments`, helpers SQL, RLS |
| `supabase/migrations/20260807010001_prepaid_contract_rpcs.sql` | `confirm_individual_prepaid_payment`, `confirm_family_prepaid_payment`, `cancel_or_refund_prepaid_contract`, `expire_ended_prepaid_contracts` |

### 14.2 Tabelas e colunas principais

- **Flags:** `academy_billing_settings.prepaid_contracts_enabled`, `family_plans_enabled` (default false)
- **plans:** `audience`, `plan_kind`, `duration_months`, `reference_monthly_price`, `package_total_amount`, `billing_mode`, `allows_installments`, `max_installments`, …
- **students:** `requested_payment_method`, `requested_installments`, `payment_review_status`, `pending_family_group_id`, `pending_family_invite_code`
- **family_groups** / **family_members** (1 aluno ativo em no máx. 1 grupo)
- **student_contracts** (party XOR) / **contract_members** / **student_contract_months** / **contract_payments**

### 14.3 RLS

- SELECT: admin academia / `can_access_student` / membro familiar conforme tabela
- ALL writes sensíveis: `is_admin_only`
- `contract_payments` SELECT familiar: só responsável financeiro (+ admin); dependentes veem meses, não o financeiro completo
- Confirmação/cancelamento preferencial via RPC SECURITY DEFINER (revalida `is_admin_only`)

### 14.4 Testes executados

- Helpers: `src/lib/prepaid-contracts.ts`
- Vitest: `src/test/prepaid-contracts.test.ts` — **14 passed**
- Migrations **não** aplicadas no banco remoto (sem teste SQL em produção/staging neste passo)
- Sem `db push`, sem cobrança, sem WhatsApp real

### 14.5 Impacto no fluxo atual (com flags off)

- Planos 210/230/250 preservados (`asaas_monthly`)
- Seed adiciona pacotes veterano + avulso no catálogo (visíveis se listagem pública não filtrar `billing_mode` — **Fase 3 deve filtrar por flag**)
- Cron / aprovação / Asaas **inalterados** até Fase 4 (skip) e ativação da flag
- Flags default false ⇒ produto prepaid/familiar desligado por academia

### 14.6 Rollback

1. **Antes de push:** remover os 2 arquivos de migration do repo.
2. **Após apply (sem dados prepaid):** migration down manual — dropar tabelas novas, colunas novas, funções/RPCs, reverter seed dos 4 planos por `name` LIKE veterano/avulso; flags `= false`.
3. **Com dados:** não dropar; desligar flags; cancelar contratos ativos via RPC; cron continua ignorando se skip já estiver deployado.

### 14.7 Fora do escopo ainda (Fases 3–5)

UI cadastro/aprovação/perfil, integração cron, WhatsApp, ativar flag Faith Brothers, commit/push/deploy.

---

## 15. Relatório Fase 3 (UI + registro — local)

**Status:** implementado em disco; **sem** commit/push/`db push`/WhatsApp real/cobrança real.

### 15.1 Arquivos alterados / criados

| Área | Arquivos |
|------|----------|
| Migration | `supabase/migrations/20260807020000_prepaid_phase3_registration.sql` |
| Cadastro | `src/pages/Cadastro.tsx`, `supabase/functions/register-student/index.ts` |
| Admin | `src/pages/Alunos.tsx`, `src/components/PrepaidApprovalDialog.tsx` |
| Perfil/Financeiro | `src/pages/MeuPerfil.tsx`, `src/pages/MeuFinanceiro.tsx`, `src/components/StudentContractOverview.tsx` |
| Domínio | `src/lib/prepaid-contracts.ts`, `src/lib/plans.ts`, `src/hooks/useQueries.ts`, `src/integrations/supabase/types.ts` |
| Cron (código local) | `supabase/functions/generate-monthly-billings/index.ts` — skip prepaid/family |
| Testes | `src/test/prepaid-registration.test.ts` (+ prepaid-contracts) |

### 15.2 Telas

- **Cadastro:** plano, individual/familiar (se flag), pagamento, parcelas crédito, criar/entrar família, pendente.
- **Alunos:** “Revisar pagamento” → dialog com meses, responsável, botões de liberação individual/família; mensal Asaas mantém “Aprovar”.
- **Meu Perfil / Meu Financeiro:** bloco contrato, meses, familiar mascarado.

### 15.3 Fluxos cobertos

- Individual prepaid → `aguardando_conferencia` → confirm RPC → meses `pago`.
- Familiar create/join → grupo + members pendentes → confirm family RPC (1 contrato, 1 pagamento, N alunos).
- `approve_student` bloqueia liberar prepaid sem confirmação de pagamento.
- Cron: `prepaid_cron_skip_reason` + `skipped_non_asaas_plan` (deploy ainda pendente).

### 15.4 Testes

- Domain: prepaid-contracts + prepaid-registration (pai+2 filhos, 1 contrato, 18 month-rows, skip Asaas familiar).
- Executar: `npm test`, `npm run build`, `npm run lint`.

### 15.5 Riscos

- Migrations ainda não aplicadas: UI chama tabelas/RPCs que só existem após `db push`.
- Flags default false: pacotes/família só aparecem após ativar na academia.
- WhatsApp de confirmação ainda não enfileirado (Fase 4).
- `types.ts` parcialmente estendido (tabelas family/contracts via cast `as never` em alguns selects).

### 15.6 Pendências Fase 4

Ver `FASE_4_GO_LIVE_PACOTES_FAMILIARES.md` — **executada em 2026-08-07**.

Pendência residual: autorização para o **primeiro pagamento real** + eventual envio WhatsApp real de `contract_approved`.

---

## 16. Conclusão

Fases 1–4 aplicadas. Produção preservada; fluxo mensal intacto; prepaid/familiar prontos com flags na Faith Brothers. **Não confirmar pagamento real sem OK explícito.**
