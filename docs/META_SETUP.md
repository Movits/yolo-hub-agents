# Configuração da WhatsApp Cloud API

Este roteiro segue a documentação oficial consultada em 12 de julho de 2026. A Graph API evolui; mantenha `META_GRAPH_VERSION` configurável e revise a versão antes do lançamento.

## 1. App, WABA e token

1. Crie um Meta App com o caso de uso de atendimento via WhatsApp.
2. Conecte ou crie a WhatsApp Business Account (WABA).
3. Anote `WABA_ID` e `PHONE_NUMBER_ID`.
4. Use o token temporário somente para o primeiro teste.
5. Para uso empresarial, crie um System User, atribua o app e a WABA e gere token com permissões:

   - `business_management`;
   - `whatsapp_business_management`;
   - `whatsapp_business_messaging`.

Referências: [Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) e [Access Tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens).

## 2. Variáveis

```env
META_GRAPH_VERSION=v25.0
WHATSAPP_WABA_ID=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=gere-uma-string-longa-e-aleatoria
META_APP_SECRET=
WHATSAPP_SEND_ENABLED=true
REQUIRE_WEBHOOK_SIGNATURE=true
```

O verify token é escolhido por você. Ele não é o access token nem o App Secret. Nunca faça commit do `.env`.

## 3. URL pública

A Meta exige HTTPS público e certificado válido; certificado self-signed não é aceito. O callback deste projeto é:

```text
https://SEU_DOMINIO/webhooks/whatsapp
```

Não há túnel instalado neste workspace. Use um domínio de desenvolvimento, um túnel HTTPS confiável ou faça deploy em seu provedor.

Referência: [Create webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint).

## 4. Challenge e assinatura

No GET de configuração, o servidor compara `hub.verify_token` e devolve `hub.challenge` como texto puro.

Nos POSTs, valida:

```text
X-Hub-Signature-256 = sha256=HMAC_SHA256(raw_body, META_APP_SECRET)
```

O cálculo usa os bytes originais antes do `JSON.parse`, com comparação em tempo constante.

## 5. Assinaturas do webhook

No painel do app, assine o campo `messages`. Depois, assine a WABA uma vez:

```http
POST https://graph.facebook.com/v25.0/{WABA_ID}/subscribed_apps
Authorization: Bearer {SYSTEM_USER_ACCESS_TOKEN}
```

Referência: [coleção oficial Webhook Subscriptions](https://www.postman.com/meta/whatsapp-business-platform/folder/ypn8q0n/webhook-subscriptions).

## 6. Mensagens, retries e status

- O parser percorre todos os `entry`, `changes` e `messages` de cada lote.
- `messages[].id` (`wamid`) é a chave de idempotência.
- `value.statuses[]` é separado de mensagens inbound.
- A resposta do endpoint de envio significa “aceita”, não “entregue”. Entrega real chega por status.
- A Meta pode repetir webhooks por até sete dias quando não recebe HTTP 200.
- No modo síncrono, falha de envio devolve HTTP 503; o retry reaproveita a resposta em cache e a fila local impede dois envios concorrentes do mesmo `wamid`.

Referências: [messages webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages), [status](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status) e [visão geral de webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview).

O modo `async` deste MVP apenas reconhece o webhook rapidamente e continua no mesmo processo. Se o processo cair, o trabalho pode ser perdido. Para produção, grave e deduplique em banco/fila durável antes de responder 200.

## 7. Janela de 24 horas

Cada mensagem do usuário abre ou reinicia uma janela móvel de atendimento de 24 horas. Dentro dela, respostas livres são permitidas. Fora dela, use somente template aprovado e opt-in válido.

O projeto guarda `lastUserMessageAt`, mas ainda não envia templates. Não use `conversation.id` para controlar a janela.

Referências: [Customer service windows](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#customer-service-windows) e [Templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview).

## 8. Limites relevantes

Segundo a documentação atual, o padrão é 80 mensagens por segundo por número, com upgrade automático possível. Existe também limite por par empresa/usuário de aproximadamente uma mensagem a cada seis segundos. Use fila por contato e não fragmente uma resposta em várias mensagens sem necessidade.

Referências: [Throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput) e [Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits).

## 9. Teste controlado

Antes de habilitar envios:

1. teste `GET /health`;
2. valide o challenge;
3. deixe `WHATSAPP_SEND_ENABLED=false` e confira os eventos;
4. ative envio apenas para números permitidos no ambiente de teste;
5. confirme status `sent`, `delivered` e `read` no log;
6. teste retry com o mesmo `wamid`;
7. teste assinatura ausente e inválida;
8. só depois conecte o número empresarial real.
