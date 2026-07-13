# Brain dos agentes

Esta pasta é um vault Markdown compatível com Obsidian e a fonte editorial do conhecimento dos
agentes. O runtime não lê notas diretamente: primeiro o conteúdo passa por revisão, validação,
avaliações críticas e publicação em uma release JSON imutável.

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

Links do Obsidian servem para navegação editorial. A publicação seleciona arquivos apenas pelas
raízes e pelo manifesto; ela nunca segue links como dependências de ingestão.

## Abrir no Obsidian

1. Abra o Obsidian e escolha **Open folder as vault**.
2. Selecione a pasta `brain/`.
3. Comece por [[HOME]].
4. Copie `agents/_template/` ao criar um agente.
5. Execute `pnpm brain:validate` antes de publicar qualquer alteração.

Arquivos `.obsidian/` e `.trash/` são locais e não entram no Git.

Este repositório é público. Os rótulos de `sensitivity` controlam a publicação no agente, não o
acesso pelo GitHub: qualquer arquivo commitado aqui fica visível para todos. Por isso este vault aceita
somente exemplos fictícios e arquitetura reutilizável. Antes de conteúdo real de clientes, mova a brain
operacional para um repositório privado dedicado, com PR obrigatório, segunda aprovação e controle de
acesso. O validador rejeita notas `confidential` e `restricted` neste scaffold. O `CODEOWNERS`
registra responsabilidade e a CI valida cada push/PR.

`pnpm public-data:check` reforça que este scaffold continue fictício, rejeitando identificadores
pessoais comuns e releases públicas com `prototype=false`. `brain-private/` é bloqueada no Git apenas
como última defesa; a brain real deve viver em outro repositório/vault privado, não numa subpasta
ignorada deste projeto.

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

## Publicar, verificar e fazer rollback

A versão e a data padrão vêm de `version` e `releaseAsOf` no `agent.json`. Para produzir a release:

```powershell
pnpm brain:validate
pnpm brain:publish --agent empresa-modelo
```

Para conferir que os arquivos em `config/releases/<agent-id>/<version>/` ainda correspondem
exatamente à brain e aos golden cases:

```powershell
pnpm brain:publish --agent empresa-modelo --check
```

Uma release publicada nunca é editada. Para mudar conteúdo, incremente `version`, publique outra
release e fixe no runtime estes quatro valores:

```env
AGENT_ID=empresa-modelo
AGENT_RELEASE_VERSION=1.0.0
AGENT_RELEASE_MANIFEST_SHA256=88ac89ba12849303d140fc9a667de1d5d7a21d511253d3a345d953ddc275abd0
AGENT_RELEASES_ROOT=./config/releases
```

Rollback é a seleção explícita de uma release anterior: restaure a versão e o SHA-256 daquele
manifesto no ambiente e reinicie o processo. Não copie conteúdo antigo por cima de uma versão nova.

Em `production`, a ausência ou divergência de qualquer seletor interrompe a inicialização. O fallback
por `COMPANY_CONFIG_PATH` existe somente em `development` e `test`, para desenvolvimento local e
testes controlados.

Uma nota aprovada pode ter vigência futura para representar uma publicação agendada. O publicador
exclui a nota até `effective_from` e depois de `expires_at`. O `runtimeConfig` do
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
