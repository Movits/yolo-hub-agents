# Checklist de produção

O protótipo foi desenhado para facilitar a evolução, mas não deve atender clientes reais apenas trocando as chaves.

Produção exige uma release de conhecimento explicitamente fixada por `AGENT_ID`,
`AGENT_RELEASE_VERSION` e `AGENT_RELEASE_MANIFEST_SHA256`. O runtime verifica manifesto,
`publicationId` e `business-knowledge.json` antes de abrir o servidor; qualquer divergência interrompe
a inicialização. `COMPANY_CONFIG_PATH` é fallback exclusivo de `development` e `test`.

O runtime oferece `MemoryStore` apenas para demo e `SqliteStore` durável para uma instância. Sessões,
deduplicação, leads, agendamentos e tickets são escopados por `tenantId` e `agentId`. O registro
estático de tenants carrega releases fixadas antes do startup, autoriza o simulador por principal e
roteia o webhook pelo binding exato WABA + número. Isso não substitui autenticação administrativa,
fila durável, backup, observabilidade ou isolamento de credenciais por connector.

## Obrigatório antes do lançamento

- substituir todos os dados fictícios e obter aprovação das respostas;
- publicar uma nova release, executar `brain:publish --check` e fixar versão + SHA-256 no ambiente;
- trocar `prototype` para `false` somente na release aprovada; o WhatsApp de produção rejeita releases protótipo;
- usar SQLite em disco persistente com backup, ou PostgreSQL quando houver múltiplas instâncias;
- usar Redis/fila para webhook e saída, com retry e dead-letter queue;
- armazenar idempotência por pelo menos o período de retry da Meta;
- assinar releases com Ed25519 e manter a chave privada fora do repositório;
- integrar CRM, agenda e help desk reais;
- criar ciclo explícito de aceitar/concluir handoff humano;
- manter `REQUIRE_WEBHOOK_SIGNATURE=true`;
- remover ou autenticar `/api/simulate` e `/api/debug/state`;
- guardar chaves em secret manager, com rotação;
- aplicar rate limit por IP, WABA e contato;
- persistir status outbound e tratar falhas da Graph API;
- implementar templates aprovados fora da janela de 24 horas;
- monitorar latência, erro, custo, handoff, opt-out e satisfação;
- criar política de retenção e exclusão de dados compatível com LGPD;
- registrar base legal/consentimento e finalidade de cada dado;
- anonimizar conversas antes de usá-las em avaliação ou melhoria;
- revisar termos da Meta, da OpenAI e políticas internas aplicáveis.

## Seleção de release e deploy

O ambiente hospedado deve declarar todos os seletores; configuração parcial também é erro:

```env
AGENT_ID=empresa-modelo
AGENT_RELEASE_VERSION=1.0.0
AGENT_RELEASE_MANIFEST_SHA256=88ac89ba12849303d140fc9a667de1d5d7a21d511253d3a345d953ddc275abd0
AGENT_RELEASES_ROOT=./config/releases
REQUIRE_RELEASE_SIGNATURE=true
RELEASE_TRUSTED_PUBLIC_KEYS={"chave-producao":"BASE64_DER_SPKI"}
STORAGE_DRIVER=sqlite
SQLITE_PATH=/var/data/yolo-hub.sqlite
```

Fluxo de mudança:

```powershell
pnpm brain:validate
pnpm brain:publish --agent empresa-modelo
pnpm brain:publish --agent empresa-modelo --check
pnpm releases:check --base-ref main
pnpm verify:deploy
```

Faça deploy somente depois de commitar a release completa: `business-knowledge.json`,
`manifest.json`, `manifest.sha256` e, para produção real, `manifest.sig.json`. O `/health` informa
agente, versão, SHA do manifesto, origem, verificação da assinatura e driver de storage, sem expor o
conhecimento.

### Assinatura Ed25519

Gere ou obtenha a chave privada em KMS/GitHub Environment. Nunca a commite. Para assinar uma release
nova antes do primeiro commit dela:

```powershell
pnpm brain:sign --agent empresa-modelo --version 1.1.0 `
  --key-id chave-producao --private-key C:\caminho-seguro\release-signing.pem
```

O runtime verifica a assinatura sobre os bytes exatos de `manifest.json`. A demo atual permanece
unsigned e é aceita somente porque `DEMO_HOSTED=true`; WhatsApp de produção exige uma assinatura
confiável, store durável e `prototype=false`.

O envio pela Graph API permanece bloqueado quando `NODE_ENV=production`. Mesmo com uma outbox, a
janela “Meta aceitou, processo caiu antes de persistir o ID” exige reconciliação explícita; um booleano
local não oferece exactly-once. Até esse fluxo existir e ser testado, use apenas mensageiro falso.

### SQLite no Render

O plano gratuito do Render perde arquivos locais em restart, sleep ou deploy e não oferece Persistent
Disk. Portanto, o `render.yaml` mantém a demo em `STORAGE_DRIVER=memory`. Para um piloto real é
necessário aprovar um plano pago com disco em `/var/data` ou escolher PostgreSQL externo. Não altere
o plano silenciosamente: isso cria custo e muda a estratégia de deploy para uma única instância.

### Multi-tenant

Use `TENANT_REGISTRY_PATH` apontando para um arquivo privado baseado em
`config/tenants.example.json`. O arquivo não contém tokens. Vincule os tokens do simulador fora do Git:

```env
DEFAULT_TENANT_ID=empresa-modelo
TENANT_REGISTRY_PATH=/config-privada/tenants.json
SIMULATOR_TENANT_TOKENS={"empresa-modelo-demo":"TOKEN_COM_32_OU_MAIS_CARACTERES"}
```

Não confie em `tenantId` recebido no body ou header. A rota autenticada deriva o principal do token,
e o webhook deriva o tenant da tupla assinada WABA + número.

O frontend do GitHub Pages é publicado pelo repositório separado
[`Movits/yolo-hub-agents-demo`](https://github.com/Movits/yolo-hub-agents-demo). Este repositório
mantém o backend, a brain, as releases e o `render.yaml`; não reintroduza um workflow Pages aqui.

### Rollback

1. Escolha uma release anterior já versionada e aprovada.
2. Leia o SHA-256 daquela release em `config/releases/<agent-id>/<versão>/manifest.sha256`.
3. Restaure `AGENT_RELEASE_VERSION` e `AGENT_RELEASE_MANIFEST_SHA256` no provedor.
4. Reinicie ou faça novo deploy sem alterar os arquivos da release.
5. Confirme `agentId` e `releaseVersion` no `/health` e execute o smoke test crítico.

Nunca sobrescreva uma versão publicada para realizar rollback. Se o provedor não conseguir carregar
ou verificar a versão anterior, mantenha o serviço indisponível em vez de cair para
`COMPANY_CONFIG_PATH`.

## Controles externos ainda obrigatórios

O código não consegue impor sozinho as permissões dos provedores. Antes de um cliente real:

- proteja `main`, bloqueie force push e exija CI + CODEOWNERS;
- deixe `AGENT_RELEASE_MANIFEST_SHA256` e a chave pública em variáveis protegidas do Render;
- mantenha a chave privada Ed25519 em KMS/GitHub Environment com aprovação;
- mantenha brains e releases de clientes em repositório/artefato privado separado;
- configure backup e teste de restauração do SQLite/PostgreSQL;
- aprove explicitamente o custo do Persistent Disk ou banco gerenciado.

## Arquitetura alvo

```text
Meta webhook
→ validar HMAC
→ gravar evento bruto criptografado e idempotente
→ publicar na fila
→ responder HTTP 200
→ worker de conversa
→ regras/FAQ/LLM
→ fila por contato
→ envio Graph API
→ worker de status
→ CRM/help desk e observabilidade
```

## Guardrails operacionais

- Não permitir resposta de IA quando a base necessária estiver ausente ou vencida.
- Exigir confirmação humana para desconto, exceção de política, reembolso e ação irreversível.
- Redigir logs e traces; telefone e conteúdo de conversa são dados pessoais.
- Limitar histórico enviado ao modelo e não incluir outros clientes.
- Definir timeout, retry com jitter, circuit breaker e orçamento por conversa.
- Versionar base, prompt e modelo; guardar qual versão gerou cada resposta.
- Rodar avaliação antes e depois de cada mudança.
- Ter um interruptor global para desativar automação e envio.

## Critério de prontidão

O lançamento só deve ocorrer quando o sistema provar, em ambiente controlado:

- nenhuma resposta duplicada em retries;
- nenhum envio após opt-out;
- nenhum preço ou política fora da base aprovada;
- nenhuma confirmação falsa de agenda, pagamento, cadastro ou chamado;
- encaminhamento funcional e observável;
- recuperação segura de falhas da Meta, OpenAI, CRM e banco;
- restauração após reinício sem perda de sessão ou fila.
