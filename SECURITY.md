# Segurança

## Dados permitidos neste repositório

Este projeto é público e contém somente dados fictícios. Não abra issues, commits ou pull requests
com tokens, senhas, conversas, dados de clientes, números de telefone reais, documentos pessoais ou
dados de saúde.

- Use `.env` local para desenvolvimento; ele é ignorado pelo Git.
- Use variáveis protegidas do Render, GitHub ou outro provedor em ambientes hospedados.
- Mantenha brains reais de clientes em armazenamento privado separado e com revisão obrigatória.
- Execute `pnpm secrets:check`, `pnpm public-data:check` e `pnpm verify:deploy` antes de enviar alterações.
- `brain-private/`, `data/`, bancos SQLite e chaves privadas são proibidos no Git por guardrails locais e CI.

## Integridade de releases

- Uma versão já publicada não pode ser alterada, removida nem receber arquivos novos; publique outra semver.
- Pull requests devem executar `pnpm releases:check --base-ref origin/main`.
- Produção real exige sidecar Ed25519 e chave pública fixada fora do repositório.
- A chave privada de assinatura pertence a KMS/GitHub Environment, nunca ao workspace ou Render.
- `AGENT_RELEASE_MANIFEST_SHA256` deve ser variável protegida, não um valor editável junto da release.

## Controles do GitHub e Render

O `CODEOWNERS` cobre brain, releases, loader, tenant registry, SQLite, workflows, lockfile e Blueprint.
Ainda é necessário ativar no GitHub a proteção de `main`, CI obrigatório, revisão do owner e bloqueio
de force push. No Render, use deploy protegido e Persistent Disk/banco com backup antes de dados reais.

## Relato de vulnerabilidade

Não publique detalhes exploráveis em uma issue. Use o recurso **Security > Report a vulnerability**
do GitHub quando disponível ou contate o mantenedor por um canal privado já conhecido.

## Se uma credencial for exposta

1. Revogue ou rotacione a credencial imediatamente.
2. Verifique logs e uso indevido no provedor.
3. Remova o segredo dos arquivos e do histórico antes de qualquer publicação.
4. Considere o valor comprometido mesmo que o commit tenha sido apagado.
