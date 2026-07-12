# Agente empresarial para WhatsApp

MVP configurável de atendimento em português brasileiro. Ele funciona imediatamente em modo determinístico, sem credenciais externas, e pode usar a OpenAI Responses API e a WhatsApp Cloud API quando as chaves forem adicionadas.

> Os dados da “Empresa Modelo” são fictícios. Eles estão centralizados em `config/company.example.json` para serem substituídos quando o contexto real estiver disponível.

## O que já funciona

- FAQ e apresentação da empresa a partir de JSON configurável;
- preços e serviços sem inventar descontos;
- captura de lead com consentimento e confirmação;
- solicitação de agendamento sem alegar que o horário foi confirmado;
- triagem de suporte com até duas orientações documentadas;
- handoff para humano com resumo e protocolo local;
- opt-out e reativação com confirmação;
- fallback progressivo e pausa após três falhas;
- proteção básica contra prompt injection, redação de segredos comuns e solicitações LGPD;
- simulador no terminal e por HTTP;
- webhook da Meta com challenge, assinatura HMAC do corpo bruto, lote, status e deduplicação;
- fila por contato, cache de resposta e retry síncrono sem repetir o raciocínio do agente;
- envio opcional pela Graph API;
- testes unitários e de integração.

## Arquitetura

```mermaid
flowchart LR
    WA["WhatsApp Cloud API"] --> WH["Webhook Fastify"]
    SIM["Terminal / API de simulação"] --> AG["Orquestrador"]
    WH --> SIG["HMAC + normalização + dedupe"]
    SIG --> AG
    AG --> RULES["Regras e fluxos"]
    AG --> KB["FAQ / configuração da empresa"]
    AG -. opcional .-> AI["OpenAI Responses API"]
    AG --> MEM["Sessões e registros em memória"]
    AG --> OUT["Adaptador de saída"]
    OUT -. quando habilitado .-> WA
```

As fronteiras estão separadas para permitir trocar a memória por PostgreSQL/Redis, o protocolo local por CRM/help desk e o processamento em linha por uma fila durável.

```text
src/
├── application/       # orquestrador, fluxos, FAQ e portas
├── adapters/          # OpenAI e WhatsApp/Meta
├── config/            # validação de ambiente e base empresarial
├── domain/            # tipos e contratos de dados
├── http/              # rotas, raw body, HMAC e coordenação de envio
└── infrastructure/    # armazenamento/outbox em memória do MVP
```

## Início rápido

Pré-requisito: Node.js 22 ou mais recente e pnpm.

### Windows: abrir a interface com dois cliques

Execute [start-ui.cmd](start-ui.cmd). Ele prepara o projeto, abre o navegador e inicia a interface em `http://127.0.0.1:3000`. Mantenha a janela do servidor aberta enquanto testa.

Esse inicializador também funciona quando `pnpm` não está no PATH: se necessário, usa `npm.cmd` como alternativa.

### Terminal interativo

```powershell
Copy-Item .env.example .env
pnpm install
pnpm chat
```

Converse normalmente no terminal. Comandos úteis:

- `/reset`: limpa a conversa atual;
- `/estado`: mostra sessões, leads, agendamentos e tickets locais;
- `/exit`: encerra o simulador.

Teste sugerido:

```text
Oi
Qual é o horário de atendimento?
Quanto custa?
Quero contratar
```

## Servidor e simulador HTTP

```powershell
pnpm dev
```

Em outro terminal:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/health

$body = @{
  userId = "cliente-teste"
  message = "Qual é o horário de atendimento?"
} | ConvertTo-Json
$utf8Body = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/simulate `
  -ContentType "application/json; charset=utf-8" `
  -Body $utf8Body
```

Principais endpoints:

| Método | Caminho | Uso |
|---|---|---|
| `GET` | `/health` | saúde e modo ativo |
| `POST` | `/api/simulate` | testa uma mensagem |
| `POST` | `/api/simulate/reset` | limpa a sessão do simulador |
| `GET` | `/api/debug/state` | inspeciona registros locais; desative em produção |
| `GET` | `/webhooks/whatsapp` | challenge de configuração da Meta |
| `POST` | `/webhooks/whatsapp` | mensagens e status do WhatsApp |

Os endpoints `/api/simulate*` e `/api/debug/state` não são registrados quando `NODE_ENV=production`.

## Personalizar a empresa

1. Duplique `config/company.example.json` como `config/company.json`.
2. Troque empresa, serviços, políticas, FAQs e procedimentos de suporte.
3. Aponte `COMPANY_CONFIG_PATH=./config/company.json` no `.env`.
4. Mantenha respostas factuais e procedimentos seguros; não coloque segredos no JSON.
5. Quando houver integrações reais, troque `prototype` para `false` somente depois de conectar CRM, agenda e atendimento humano.

Não é necessário “treinar” um modelo para a primeira versão. Alimentar e revisar a base de conhecimento costuma ser mais rápido, barato e controlável. Fine-tuning pode ser avaliado depois, com conversas reais anonimizadas e um conjunto de testes.

## Habilitar a OpenAI

Adicione ao `.env`:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

A integração usa a Responses API com saída estruturada. A IA só é chamada quando regras e FAQs não resolvem a pergunta. Sem chave, o agente continua funcional em modo determinístico. O modelo fica configurável para que custo, latência e qualidade possam ser avaliados sem alteração de código.

Referências oficiais: [geração de texto com Responses API](https://developers.openai.com/api/docs/guides/text) e [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Conectar ao WhatsApp

O passo a passo detalhado está em [docs/META_SETUP.md](docs/META_SETUP.md). Em resumo:

1. Configure um app da Meta e uma WABA.
2. Crie um token de System User e guarde-o como segredo.
3. Exponha este servidor em HTTPS público.
4. Cadastre `https://SEU_DOMINIO/webhooks/whatsapp` como callback.
5. Preencha as variáveis `META_*` e `WHATSAPP_*`.
6. Ative `WHATSAPP_SEND_ENABLED=true` e `REQUIRE_WEBHOOK_SIGNATURE=true`.

## Verificação

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Consulte [docs/TESTING.md](docs/TESTING.md) para o roteiro funcional e [docs/PRODUCTION.md](docs/PRODUCTION.md) antes de usar com clientes reais.

## Limites deliberados deste MVP

- sessões e registros somem ao reiniciar;
- não há CRM, calendário, help desk ou atendente conectados;
- o modo assíncrono usa apenas a memória do processo, não uma fila durável;
- mídia não é transcrita ou analisada;
- templates fora da janela de 24 horas não são enviados;
- não há painel administrativo, autenticação do simulador nem métricas de produção.

Esses limites estão explícitos nas mensagens do modo `prototype`, evitando que um teste pareça uma ação real.
