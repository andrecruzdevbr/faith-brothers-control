# Conclusão operacional V1.0

**Data (UTC):** 2026-10-25  
**Tag `v1.0.0`:** `05e63fc57f1122467366a58ff0cf6e5945cc2a21` — **não modificada**  
**Projeto Production:** `wojqjxtaqjasnfhbotxi` (`faith-brothers-prod`, `ACTIVE_HEALTHY`, Postgres 17.6.1.127, `us-west-2`)  
**Staging:** `apbksfaztfkxshxffpik` (separado)

Esta rodada não alterou secrets, crons, alunos, cobranças nem a tag.

---

## 1. Backup recuperável: NÃO

### Plano

O CLI `projects list` **não devolve o nome do plano** (Free/Pro/Team). Org: `andrecruzdevbr's Org`. Sem essa informação, backups diários automáticos (só Pro+) **não podem ser afirmados**.

### Mecanismos oficiais

| Mecanismo | Disponível agora | Custo extra | Artefato restaurável visto |
|-----------|------------------|-------------|----------------------------|
| WAL-G físico (`walg_enabled`) | sim | incluso no pipeline físico do Postgres ≥15.8 | **não** — lista vazia |
| Backups diários (Dashboard, Pro+) | só se o plano for Pro+ | plano pago | **não listados** pela API |
| PITR | `pitr_enabled=false` | add-on (~USD 100/mês 7 dias) + compute Small | não |
| `supabase backups restore` | só com timestamp PITR | — | inutilizável hoje |
| `supabase db dump` | possível | nenhum de produto; **exporta PII** | **não executado** |

Consulta 2026-10-25:

```text
supabase backups list --project-ref wojqjxtaqjasnfhbotxi
```

`backups: null`, `physical_backup_data: {}`, `pitr_enabled: false`, `walg_enabled: true`.

Nenhum snapshot com `inserted_at`. Nenhum restore. Nenhum dump.

### Autorização necessária para BACKUP CONFIRMADO

1. Abrir [Database → Backups](https://supabase.com/dashboard/project/wojqjxtaqjasnfhbotxi/database/backups) e confirmar se há restore points diários (exige plano Pro+).
2. Se o projeto for Free: **upgrade para Pro** (custo) para backups diários automáticos, retenção 7 dias, restore pelo Dashboard.
3. Opcional: ligar **PITR** (add-on + compute Small). CLI: `supabase backups restore --timestamp <epoch>` — derruba o projeto durante o restore.
4. Dump lógico off-site (`db dump`) só com autorização para tratar dados pessoais **fora** do GitHub.

---

## 2. Automações (somente leitura, 2026-10-25)

| Controle | Estado |
|----------|--------|
| WhatsApp Queue | **active** + `event=schedule` success (40170683244 06:52Z, 40191735244 12:07Z, `processed:0`) |
| Billing | `disabled_manually` |
| Birthday | `disabled_manually` |
| SEND | `true` |
| Allowlist | 1 homologação `5531*****4156` |
| Fila elegível | **0** (5 `sent` históricas) |
| Cobranças | **0** |
| Alunos `ativo` | **0** (1 `pendente_aprovacao`) |

Nada pendente seria enviado no próximo cron da fila. Nenhuma cobrança inesperada.

---

## 3. Sequência de liberação (não executada)

Ordem obrigatória. Uma autorização por passo. Não juntar 2 e 3.

### Passo A — Remover restrição de destinatários

1. Autorização explícita.
2. Reconfirmar fila elegível = 0.
3. **Apagar** o secret `WHATSAPP_ALLOWED_RECIPIENTS` (não deixar vazio: vazio bloqueia todos).
4. Conferir digest/ausência no Dashboard.
5. Observar o próximo `schedule` da Queue (`processed` e falhas `recipient_not_allowed`).

Rollback A: recriar o secret com o número de homologação; ou `WHATSAPP_SEND_ENABLED=false`.

### Passo B — Ativar Birthday

1. Autorização explícita **depois** do passo A (ou ciente de que a allowlist ainda filtra).
2. `gh workflow enable birthday-cron.yml` (id 324887354).
3. Primeira execução: cron diário `0 11 * * *` UTC (08:00 BRT). Só `status=ativo`.
4. Conferir run `event=schedule` e `birthday_messages` do dia (sem PII no relatório).

Rollback B: `gh workflow disable birthday-cron.yml` imediatamente.

### Passo C — Ativar Billing

1. Autorização explícita **em janela separada**.
2. Saber: Asaas é **live** (`api.asaas.com/v3`). Generate no dia 12 11:00 UTC cria boleto real. Overdue no dia 19 envia lembrete.
3. `send_whatsapp_automatically=true` — boleto também enfileira WhatsApp.
4. Hoje: 0 `ativo` → generate agora criaria 0 cobranças; habilitar mesmo assim **arma** o dia 12.
5. `gh workflow enable billing-cron.yml` (id 323370156).
6. Primeira conferência segura: `workflow_dispatch` job `auth_check` (não chama function).
7. Não disparar `generate` / `overdue` na mão sem autorização extra.

Rollback C: `gh workflow disable billing-cron.yml` imediatamente. Não apagar boletos Asaas sem ordem financeira.

### Confirmação da primeira execução

| Automação | Prova |
|-----------|--------|
| Queue | já validada (`processed:0` em schedule) |
| Birthday | run `schedule` success + 0 envios se não houver `ativo` aniversariante |
| Billing | `auth_check` success; generate só no dia 12 ou com autorização |

---

## Rollback geral

1. `WHATSAPP_SEND_ENABLED=false`
2. Disable Queue, Billing, Birthday
3. Recolocar allowlist de homologação
4. SPA/functions: tag `v1.0.0`
5. Sem restore de banco sem autorização (PITR está off)
