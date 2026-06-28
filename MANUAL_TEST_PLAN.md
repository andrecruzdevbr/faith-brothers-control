# Faith Brothers Hub — Plano de Teste Manual

Execute após deploy em Supabase + Vercel. Marque cada item ao concluir.

**Ambiente:** `https://SEU-DOMINIO.vercel.app`
**Data do teste:** _______________
**Responsável:** _______________

---

## Credenciais de teste

Preencha com contas reais criadas em produção (não use senhas de DEV em produção).

| Papel | WhatsApp | Senha |
|-------|----------|-------|
| Admin (ex. Ramon) | | |
| Professor-only* | | |
| Aluno | | |

\* Se todos os staff têm admin+professor, crie um usuário só com role `professor` via `manage_staff_member` para este teste.

---

## 1. Autenticação

### 1.1 Login Admin

- [ ] Acessar `/login`
- [ ] Informar WhatsApp do admin (só dígitos, ex. `31987540515`)
- [ ] Informar senha
- [ ] Clicar **Entrar**
- [ ] **Esperado:** redirecionamento para `/dashboard`
- [ ] Menu exibe: Dashboard, Alunos, Turmas, Presenças, Graduação, Ranking, Relatórios, **Financeiro**, **Professores**, **Configurações**

### 1.2 Login Professor (sem admin)

- [ ] Logout → login com conta professor-only
- [ ] **Esperado:** `/dashboard` com menu **sem** Financeiro, Professores, Configurações
- [ ] Tentar acessar manualmente `/financeiro`
- [ ] **Esperado:** redirect para `/dashboard`

### 1.3 Login Aluno

- [ ] Logout → login com conta aluno
- [ ] **Esperado:** redirect para `/minha-presenca`
- [ ] Menu: Minhas Presenças, Minha Graduação, Meu Ranking, Meus Pagamentos, Meu Perfil
- [ ] Tentar acessar `/dashboard`
- [ ] **Esperado:** redirect para `/minha-presenca`

### 1.4 Cadastro novo aluno

- [ ] Logout → `/cadastro`
- [ ] Preencher nome, WhatsApp novo, academia, senha (mín. 8 chars)
- [ ] **Esperado:** conta criada, status `pendente_aprovacao`
- [ ] Admin aprova em `/alunos`
- [ ] **Esperado:** aluno passa a `ativo`

### 1.5 Recuperação de senha

- [ ] `/recuperar-senha` → informar WhatsApp cadastrado
- [ ] **Esperado:** OTP recebido no WhatsApp
- [ ] Informar código + nova senha (mín. 8 chars)
- [ ] **Esperado:** login com nova senha funciona
- [ ] Repetir solicitação OTP 6+ vezes em 1 hora
- [ ] **Esperado:** rate limit bloqueia

---

## 2. Permissões (RBAC)

### 2.1 Isolamento entre alunos

- [ ] Login como **Aluno A**
- [ ] Abrir DevTools → Network → inspecionar chamadas Supabase
- [ ] **Esperado:** queries retornam apenas dados do próprio aluno
- [ ] Login como **Aluno B**
- [ ] **Esperado:** não vê presenças/pagamentos do Aluno A

### 2.2 Admin vs Professor

| Ação | Admin | Professor |
|------|-------|-----------|
| Ver `/financeiro` | [ ] Sim | [ ] Não (redirect) |
| Ver `/configuracoes` | [ ] Sim | [ ] Não |
| Ver `/professores` | [ ] Sim | [ ] Não |
| Ver `/alunos` | [ ] Sim | [ ] Sim |
| Registrar presença QR | [ ] Sim | [ ] Sim |
| Alterar graduação | [ ] Sim | [ ] Sim |

### 2.3 Seed bloqueado em produção

```bash
curl -X POST "https://SEU-PROJECT-REF.supabase.co/functions/v1/seed-admin-users" \
  -H "Content-Type: application/json"
```

- [ ] **Esperado:** HTTP 403 — `Seed desabilitado em produção`

---

## 3. Dashboard

Login como **admin**.

- [ ] Cards exibem números reais (não zeros fixos/mock)
- [ ] Total de alunos / ativos / inativos coerentes com `/alunos`
- [ ] Receita mensal e anual refletem `billings` pagos
- [ ] Inadimplentes coerentes com status `vencido`
- [ ] Presença do dia atualiza após check-in
- [ ] Gráficos carregam sem erro no console

---

## 4. Alunos

- [ ] Lista carrega do Supabase com paginação
- [ ] Busca por nome filtra resultados
- [ ] Aprovar aluno `pendente_aprovacao` → status `ativo`
- [ ] Rejeitar aluno → status `rejeitado`

---

## 5. Financeiro (admin only)

- [ ] `/financeiro` exibe planos reais da academia
- [ ] Lista de cobranças com status corretos
- [ ] Botão **Reenviar WhatsApp** em cobrança pendente
- [ ] **Esperado:** mensagem na tabela `whatsapp_messages` + WhatsApp recebido
- [ ] Dados bancários vêm de `academies` (não hardcoded)

### 5.1 Meu Financeiro (aluno)

- [ ] Login aluno → `/meu-financeiro`
- [ ] Exibe plano, status (em dia/atrasado), histórico
- [ ] Link boleto/PIX abre URL Asaas quando disponível
- [ ] Cobranças pagas mostram data e número de recibo

### 5.2 Webhook Asaas

- [ ] Simular pagamento no sandbox Asaas
- [ ] **Esperado:** `billings.status` → `pago`
- [ ] **Esperado:** WhatsApp de confirmação (se Evolution ativa)

### 5.3 Cron de cobrança (opcional — dia 12)

```bash
curl -X POST "https://SEU-PROJECT-REF.supabase.co/functions/v1/generate-monthly-billings" \
  -H "x-cron-secret: SEU_SECRET" \
  -H "Content-Type: application/json" \
  -d "{}"
```

- [ ] **Esperado:** JSON `{ success: true, processed: [...] }`

---

## 6. WhatsApp

### 6.1 Teste admin (`/configuracoes`)

- [ ] Login admin → Configurações
- [ ] Enviar mensagem de teste para número válido
- [ ] **Esperado:** sucesso + registro em histórico

### 6.2 Fila

```bash
curl -X POST "https://SEU-PROJECT-REF.supabase.co/functions/v1/process-whatsapp-queue" \
  -H "x-cron-secret: SEU_SECRET"
```

- [ ] **Esperado:** `{ success: true, processed: N }`

### 6.3 Presença (confirmação automática)

- [ ] Aluno marca presença via QR
- [ ] **Esperado:** WhatsApp "Presença confirmada" (best-effort)

---

## 7. Presença por QR Code

### Professor

- [ ] Login staff → `/presencas`
- [ ] Clicar **Iniciar sessão** / gerar QR
- [ ] **Esperado:** QR exibido com token de 10 min
- [ ] Lista de presenças atualiza em tempo real

### Aluno

- [ ] Login aluno → `/minha-presenca`
- [ ] Escanear QR válido
- [ ] **Esperado:** presença registrada
- [ ] Segunda tentativa no mesmo dia
- [ ] **Esperado:** mensagem "já registrada hoje"
- [ ] QR expirado
- [ ] **Esperado:** erro de expiração

### Segurança

- [ ] Aluno **não** consegue ler `attendance_sessions.token` via API direta (RLS)
- [ ] Presença só via Edge Function / RPC `record_attendance_by_token`

---

## 8. Graduação

- [ ] Staff → `/graduacao` — lista alunos com faixas reais
- [ ] Alterar faixa/grau de um aluno (se UI disponível ou via RPC)
- [ ] Aluno → `/minha-graduacao` — vê apenas própria faixa

---

## 9. Ranking

- [ ] Staff → `/ranking` — leaderboard por presenças (30 dias)
- [ ] Aluno → `/meu-ranking` — mesma base, posição do aluno visível

---

## 10. Turmas e Relatórios

- [ ] `/turmas` — cards com horários de `classes`
- [ ] `/relatorios` — gráficos carregam sem erro

---

## 11. Professores (admin only)

- [ ] `/professores` — lista staff com roles
- [ ] Formulário `manage_staff_member` — promover usuário existente
- [ ] **Esperado:** roles atualizados após refresh

---

## 12. Regressão de build

```bash
npm test
npm run build
```

- [ ] Ambos passam sem erro

---

## Resultado do teste

| Área | Status | Observações |
|------|--------|-------------|
| Auth | ☐ OK ☐ FALHA | |
| Permissões | ☐ OK ☐ FALHA | |
| Dashboard | ☐ OK ☐ FALHA | |
| Financeiro | ☐ OK ☐ FALHA | |
| WhatsApp | ☐ OK ☐ FALHA | |
| Presença QR | ☐ OK ☐ FALHA | |
| Graduação | ☐ OK ☐ FALHA | |

**Aprovado para usuários reais:** ☐ Sim ☐ Não

**Assinatura:** _______________
