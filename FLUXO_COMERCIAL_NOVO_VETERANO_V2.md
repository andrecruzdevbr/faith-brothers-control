# FLUXO COMERCIAL NOVO / VETERANO V2

Data: 2026-08-09  
Escopo: implementação **local** (sem push, sem deploy, sem migration em produção, sem WA/Asaas reais).

## Auditoria do catálogo (produção — leitura)

### NEW_STUDENT

| Plano | Existe? | Valor |
|-------|---------|-------|
| Mensal 2 dias | SIM | R$ 210,00 |
| Mensal 3 dias | SIM | R$ 230,00 |
| Mensal 5 dias | SIM | R$ 250,00 |
| Trimestral | NÃO | — (estrutura UI/ADM pronta; aguarda cadastro oficial) |
| Semestral | NÃO | — (estrutura UI/ADM pronta; aguarda cadastro oficial) |
| Anual | NÃO | — (estrutura UI/ADM pronta; aguarda cadastro oficial) |

### VETERAN

| Plano | Estrutura | Valor |
|-------|-----------|-------|
| Mensal 2/3/5 | Pronta (audience=`veterano` + catálogo ADM) | **aguardando cliente** (não copiar new_student) |
| Trimestral 2/3/5 | Pronta | **aguardando cliente** |
| Semestral 2/3/5 | Seed antigo existe no banco | Seed 720/900/1080 — **confirmar com cliente** (não inventar novo) |
| Anual 2/3/5 | Seed antigo existe no banco | Seed 1440/1800/2160 — **confirmar com cliente** |

Seeds veterano (semestral/anual/avulso) já estavam no banco de go-lives anteriores. Esta V2 **não inventa** preços novos e **proíbe** usar preço `new_student` no mensal veterano.

## Regras implementadas

1. Cadastro público pede **apenas faixa** (graus default `0`; coluna/histórico preservados).
2. Novo: dados → faixa → plano (mensal 2/3/5 direto + período se existir) → pagamento → pendente ADM.
3. Veterano: dados → faixa → frequência 2/3/5 → **sem plano/preço/pagamento** no público.
4. Após aprovação ADM: WhatsApp `registration:{id}:approved` para todos; veterano também recebe orientação comercial (`veteran_period_request`).
5. Plano/pagamento do veterano só no ADM (`VeteranPeriodDialog`), após aprovação.
6. Se plano veterano sem valor configurado: mensagem **“Plano veterano aguardando configuração de valor.”** — sem cobrança.
7. Cartão/maquininha nunca auto-pago.
8. Boleto mensal Asaas preservado.
9. Family V2 preservado (graus removidos da UI pública).
10. Catálogo ADM em **Financeiro → CATÁLOGO COMERCIAL** para cadastrar/ativar valores sem código.

## Arquivos principais

- `src/lib/registration-flows.ts` — filtros, grupos mensal/período, match só `veterano`
- `src/pages/Cadastro.tsx` — UI novo/veterano
- `src/components/family/FamilyRegistrationWizard.tsx` — sem graus
- `src/components/VeteranPeriodDialog.tsx` — plano pós-aprovação
- `src/components/PlanCatalogManager.tsx` — CRUD catálogo ADM
- `src/pages/Alunos.tsx` — WA aprovação + follow-up veterano
- `supabase/functions/_shared/whatsapp.ts` — idempotência por chave (received ≠ approved)
- `supabase/functions/_shared/whatsapp-messages.ts` — textos V2
- `supabase/functions/register-student/index.ts` — degrees forçado `0`
- `supabase/migrations/20260809120000_veteran_plan_no_new_student_prices.sql` — **local only**, não aplicada em produção

## Segurança

- Público não escolhe audience de plano manualmente além do fluxo Novo/Veterano.
- Match de plano veterano exige `audience=veterano` + preço > 0.
- Novo só filtra planos new_student/normal (nunca veterano).
- Pagamento pago só via ADM / Asaas webhook (fluxos existentes).

## Produção

**NÃO alterada** nesta entrega (sem push/deploy/`db push`).
