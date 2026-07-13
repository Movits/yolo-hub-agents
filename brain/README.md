# Brain dos agentes

Esta pasta é um vault Markdown compatível com Obsidian e a futura fonte de conhecimento dos agentes.
Ela não é lida pelo runtime atual: primeiro o conteúdo passa por revisão, validação e publicação.

## Regra de composição

```text
brain/shared
  + brain/segments/<segmento> (futuro)
  + brain/agents/<agent-id>
  = conhecimento publicado do agente
```

O motor do WhatsApp continua compartilhado. Cada agente possui conhecimento, fluxos, avaliações e
limites próprios. Políticas obrigatórias de segurança nunca podem ser substituídas por uma nota da
empresa.

Links do Obsidian servem para navegação editorial. A futura publicação selecionará arquivos apenas
pelas raízes e pelo manifesto; ela nunca seguirá links como dependências de ingestão.

## Abrir no Obsidian

1. Abra o Obsidian e escolha **Open folder as vault**.
2. Selecione a pasta `brain/`.
3. Comece por [[HOME]].
4. Copie `agents/_template/` ao criar um agente.
5. Execute `pnpm brain:validate` antes de publicar qualquer alteração.

Arquivos `.obsidian/` e `.trash/` são locais e não entram no Git.

Este repositório é público. Os rótulos de `sensitivity` controlam a futura publicação no agente, não o
acesso pelo GitHub: qualquer arquivo commitado aqui fica visível para todos. Por isso este vault aceita
somente exemplos fictícios e arquitetura reutilizável. Antes de conteúdo real de clientes, mova a brain
operacional para um repositório privado dedicado, com PR obrigatório, segunda aprovação e controle de
acesso. O validador rejeita notas `confidential` e `restricted` neste scaffold. O `CODEOWNERS`
registra responsabilidade e a CI valida cada push/PR.

## Ciclo editorial

```text
draft -> in-review -> approved -> retired
```

Somente notas `approved` cuja `sensitivity` esteja autorizada em `publishSensitivity` podem entrar no
índice público do agente. Fluxos e avaliações internas continuam disponíveis para orquestração e
testes, mas não para recuperação em respostas. Alterar conhecimento não altera o runtime
automaticamente. `pnpm brain:publish --agent <agent-id> --as-of <YYYY-MM-DD>` compila blocos
`brain-runtime`, executa os blocos `brain-eval` críticos e gera uma release imutável em
`config/releases/<agent-id>/<version>/`. Wikilinks continuam servindo apenas para navegação.

Cada fato executável fica em um bloco JSON explícito. O publicador não interpreta a prosa Markdown,
não segue links e não lê `source` como dependência. O `runtimeConfig` é usado apenas como oracle de
migração: enquanto essa ponte existir, a compilação falha se o JSON gerado divergir dela.

Uma nota aprovada pode ter vigência futura para representar uma publicação agendada. O publicador
deverá excluí-la até `effective_from` e excluir qualquer nota após `expires_at`. O `runtimeConfig` do
manifesto é apenas uma ponte de migração para o protótipo atual: ele deve ficar em `config/`, declarar
o mesmo `agentId` e passar pelo schema empresarial; não é uma instrução para ingerir arquivos.

## Limites de conteúdo

- Permitido: informações institucionais aprovadas, serviços, FAQs, políticas e procedimentos.
- Proibido: chaves, senhas, tokens, conversas, leads, telefones reais de clientes, prontuários e
  documentos pessoais.
- Considere qualquer workspace sincronizado como replicado em nuvem; use apenas conteúdo fictício
  neste scaffold público.
- Conteúdo de clínica deve limitar-se a informações institucionais e fluxos aprovados. Dados de saúde
  nunca entram neste vault.
- Toda nota precisa declarar responsável, sensibilidade, versão, vigência e origem.

Veja também [[governance/publishing-policy|Política de publicação]].
