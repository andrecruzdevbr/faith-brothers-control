# Catálogo oficial de planos veteranos — Faith Brothers

**Status:** GO-LIVE aplicado (migration remota + código).  
**Produção (catálogo plans):** atualizada em 2026-08-11 via `20260812120000`.  
**Relatório de go-live:** `GO_LIVE_CATALOGO_VETERAN.md`

**Migration list:** `20260812120000` Local + Remote.

---

## Interpretação oficial

### Mensal / boleto (por frequência)

| Frequência | Valor / mês | Pagamento |
|------------|-------------|-----------|
| 2 dias/semana | R$ 130,00 | Boleto (Asaas) |
| 3 dias/semana | R$ 150,00 | Boleto (Asaas) |
| 5 dias/semana | R$ 180,00 | Boleto (Asaas) |

Sem oferta de 1 dia (preço não fornecido).

### Fidelidade / cartão (por modalidade — frequência independente)

| Modalidade | Valor / mês | Meses | Total contratual | Pagamento |
|------------|-------------|-------|------------------|-----------|
| Trimestral | R$ 160,00 | 3 | **R$ 480,00** | Cartão / maquininha |
| Semestral | R$ 130,00 | 6 | **R$ 780,00** | Cartão / maquininha |
| Anual | R$ 110,00 | 12 | **R$ 1.320,00** | Cartão / maquininha |

**Não** existe matriz 2/3/5 para T/S/A. A frequência do cadastro fica em `requested_training_days` e no contrato (`weekly_frequency`) sem alterar o preço.

Totais = `monthly_price × duration_months`, validados no backend (`set_veteran_billing_period` + `confirm_individual_prepaid_payment`).

---

## Fluxo preservado

1. Cadastro: veterano escolhe só 2 / 3 / 5 — sem preço / pagamento.
2. ADM aprova → `registration_approved` → aguarda definição comercial.
3. ADM escolhe Mensal / Trimestral / Semestral / Anual.
4. Cartão: fica `aguardando_conferencia` até “Pagamento aprovado”.
5. Só então libera cobertura (3 / 6 / 12 meses) e `payment_confirmed`.

---

## Migration

`supabase/migrations/20260812120000_official_veteran_monthly_catalog.sql`

- Desativa seeds legacy T/S/A por dias + avulso
- Upsert 3 mensais oficiais
- Upsert 3 prepaid oficiais (days = NULL)
- Atualiza RPCs de definição e confirmação com validação de totais

---

## App

- `matchVeteranPlan`: mensal por dias; prepaid por modalidade
- `VeteranPeriodDialog`: mostra mensal + total contratual
- Situação do aluno: Veterano + modalidade, frequência, R$/mês, total, pagamento, período, cobertura

---

## Testes

- `npm test` → 28 files / 234 tests passed  
- `npm run build` → OK  
- `npm run lint` → 0 errors (3 warnings pré-existentes)

---

## Checklist

| Item | Resultado |
|------|-----------|
| mensal 2d R$130 boleto | SIM |
| mensal 3d R$150 boleto | SIM |
| mensal 5d R$180 boleto | SIM |
| trimestral R$160/mês total R$480 cartão | SIM |
| semestral R$130/mês total R$780 cartão | SIM |
| anual R$110/mês total R$1.320 cartão | SIM |
| frequência independente nos prepaid | SIM |
| cobertura 3/6/12 | SIM |
| confirmação cartão somente ADM | SIM |
| cadastro veteran preservado | SIM |
| new_student / Family V2 | SIM |
| migration aplicada | SIM |
