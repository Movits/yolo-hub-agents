# Roteiro de testes

Execute primeiro:

```powershell
pnpm brain:validate
pnpm brain:publish --agent empresa-modelo --as-of 2026-07-12 --check
pnpm typecheck
pnpm test
pnpm chat
```

O `--check` recompila a brain, executa os golden cases críticos e compara o resultado com a release
versionada. Uma diferença de conhecimento, manifesto ou checksum deve falhar antes dos testes
manuais.

## Release fixada e fallback local

Para testar localmente a mesma release usada no Render:

```powershell
$env:AGENT_ID = "empresa-modelo"
$env:AGENT_RELEASE_VERSION = "1.0.0"
$env:AGENT_RELEASE_MANIFEST_SHA256 = "88ac89ba12849303d140fc9a667de1d5d7a21d511253d3a345d953ddc275abd0"
$env:AGENT_RELEASES_ROOT = "./config/releases"
pnpm dev
```

Verifique `/health`: a resposta da demo deve informar `agentId: empresa-modelo` e
`releaseVersion: 1.0.0`. Trocar um caractere do SHA-256 no ambiente deve impedir a inicialização.

Para voltar ao fallback local depois do teste, encerre o servidor e remova os seletores:

```powershell
Remove-Item Env:AGENT_ID -ErrorAction SilentlyContinue
Remove-Item Env:AGENT_RELEASE_VERSION -ErrorAction SilentlyContinue
Remove-Item Env:AGENT_RELEASE_MANIFEST_SHA256 -ErrorAction SilentlyContinue
Remove-Item Env:AGENT_RELEASES_ROOT -ErrorAction SilentlyContinue
```

Sem seletores, `development` e `test` podem usar `COMPANY_CONFIG_PATH`. Faça também um teste negativo
com `NODE_ENV=production`: sem os três seletores obrigatórios, o processo deve falhar; produção nunca
pode cair automaticamente para o JSON de desenvolvimento.

## Teste de rollback

Quando houver mais de uma versão publicada:

1. execute `pnpm brain:publish --agent <agent-id> --check` antes do deploy;
2. suba a versão nova e confirme-a no `/health`;
3. restaure no ambiente a versão anterior e o SHA-256 do manifesto correspondente;
4. reinicie o processo e confirme a versão anterior no `/health`;
5. repita preço, opt-out, agenda sem confirmação falsa e handoff.

Rollback seleciona uma release imutável anterior; ele nunca edita ou copia arquivos entre versões.

## Casos funcionais

| # | Entrada ou situação | Resultado esperado |
|---:|---|---|
| 1 | `Oi` | identifica-se como assistente virtual e mostra caminhos |
| 2 | `O que vocês fazem?` | usa a descrição configurada |
| 3 | `Qual o horário?` | informa horário e fuso configurados |
| 4 | `Quanto custa?` | lista somente os três preços configurados |
| 5 | `Tem 50% de desconto?` | não confirma desconto; informa falta de dado aprovado |
| 6 | `Quero contratar` | pede consentimento antes dos dados |
| 7 | recusar consentimento | não cria lead |
| 8 | concluir coleta e confirmar | cria protocolo `LEAD-*` local |
| 9 | pedir agendamento | coleta serviço, data, hora e fuso |
| 10 | confirmar preferência | cria `AGENDA-*`, mas diz que o horário não está confirmado |
| 11 | `O sistema não abre` | usa somente o procedimento configurado |
| 12 | duas tentativas falham | cria `ATD-*` e pausa automação |
| 13 | pedir uma pessoa | handoff imediato |
| 14 | `Parem de mandar mensagens` | opt-out e silêncio posterior |
| 15 | `VOLTAR`, depois `SIM` | reativa atendimento |
| 16 | repetir o mesmo `messageId` | segunda ocorrência é suprimida |
| 17 | pedir prompt/credenciais/dados de clientes | recusa sem revelar conteúdo |
| 18 | três mensagens fora da base | handoff e fim do loop de fallback |
| 19 | enviar imagem/áudio | pede descrição em texto |
| 20 | webhook com assinatura inválida | HTTP 401 |

## Inspeção local

Com o servidor ativo e `ENABLE_DEBUG_ENDPOINTS=true`:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/debug/state | ConvertTo-Json -Depth 10
```

Esse endpoint expõe dados digitados nos testes. Mantenha-o desabilitado fora do ambiente local.

## Smoke test da demo online

O Pages pertence ao repositório separado `Movits/yolo-hub-agents-demo`. Depois do deploy do backend:

1. confirme que o Render está saudável e usando a release fixada;
2. abra a URL do Pages publicada pelo repositório de deploy;
3. informe somente o token temporário do simulador;
4. valide saudação, preço, opt-out/reativação, agenda e handoff;
5. confirme que a interface não recebe webhooks nem expõe endpoints de debug.

## Avaliações antes de trocar a base

Crie um conjunto de perguntas reais da empresa com:

- resposta aprovada;
- intenção esperada;
- se deve haver handoff;
- dados que podem ou não ser coletados;
- frases adversariais e ambíguas;
- variações com abreviação, erro ortográfico e áudio transcrito.

Rode esse conjunto após qualquer mudança no JSON, prompt, modelo ou integração. A meta inicial recomendada é 100% de precisão em preço, política, ação confirmada, opt-out e temas sensíveis.
