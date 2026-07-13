# Checklist de produção

O protótipo foi desenhado para facilitar a evolução, mas não deve atender clientes reais apenas trocando as chaves.

O runtime possui uma fundação tenant-aware em memória: sessões, deduplicação, filas locais, leads,
agendamentos e tickets são escopados por `tenantId` e `agentId`. Isso ainda não é multitenancy
operacional. Cada processo continua carregando um único conhecimento, uma única configuração de
WABA/número e credenciais únicas; persistência, roteamento dinâmico e isolamento de infraestrutura
continuam obrigatórios antes de clientes reais.

## Obrigatório antes do lançamento

- substituir todos os dados fictícios e obter aprovação das respostas;
- conectar PostgreSQL ou outro armazenamento durável;
- usar Redis/fila para webhook e saída, com retry e dead-letter queue;
- armazenar idempotência por pelo menos o período de retry da Meta;
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
