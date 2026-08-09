# Regras de pagamento e WhatsApp (cadastro)

**Migration:** `20260808220000_registration_payment_whatsapp_rules.sql`  
**Edge:** `notify-registration-event` (além de `register-student` / `notify-contract-approved`)

## Novo aluno (`new_student`)

1. Escolhe “Ainda não sou aluno / Quero iniciar”
2. Vê planos `audience=new_student|normal` mensais
3. Escolhe plano + forma (`boleto` ou maquininha)
4. Cartão: parcelas; status `aguardando_conferencia` — **nunca pago automático**
5. Cadastro `pendente_aprovacao` + WA `registration` (idempotente)
6. Boleto: ADM **Aprovar** → `ativo` → Asaas no calendário
7. Cartão: ADM **Pagamento aprovado** → contrato `pago` + meses + WA confirmação

## Veterano

1. Escolhe 2 / 3 / 5 dias (sem pacote ainda)
2. ADM **Aprovar cadastro** → `billing_period_status=aguardando_escolha` + WA pedindo mensal/semestral/anual
3. ADM **Definir modalidade**
   - Mensal → plano Asaas + `ativo`
   - Semestral/anual → pacote maquininha + `aguardando_conferencia`
4. Cartão só libera com confirmação ADM

## Familiar

Mensagens financeiras apenas ao responsável (inalterado em `notify-contract-approved`).

## Regra global de cartão

`cartao_*` / pix / dinheiro na maquininha: só ADM confirma; público nunca marca pago.
