# Roteiro de testes

Execute primeiro:

```powershell
pnpm typecheck
pnpm test
pnpm chat
```

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

## Avaliações antes de trocar a base

Crie um conjunto de perguntas reais da empresa com:

- resposta aprovada;
- intenção esperada;
- se deve haver handoff;
- dados que podem ou não ser coletados;
- frases adversariais e ambíguas;
- variações com abreviação, erro ortográfico e áudio transcrito.

Rode esse conjunto após qualquer mudança no JSON, prompt, modelo ou integração. A meta inicial recomendada é 100% de precisão em preço, política, ação confirmada, opt-out e temas sensíveis.
