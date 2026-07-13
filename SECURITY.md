# Segurança

## Dados permitidos neste repositório

Este projeto é público e contém somente dados fictícios. Não abra issues, commits ou pull requests
com tokens, senhas, conversas, dados de clientes, números de telefone reais, documentos pessoais ou
dados de saúde.

- Use `.env` local para desenvolvimento; ele é ignorado pelo Git.
- Use variáveis protegidas do Render, GitHub ou outro provedor em ambientes hospedados.
- Mantenha brains reais de clientes em armazenamento privado separado e com revisão obrigatória.
- Execute `pnpm secrets:check` e `pnpm brain:validate` antes de enviar alterações.

## Relato de vulnerabilidade

Não publique detalhes exploráveis em uma issue. Use o recurso **Security > Report a vulnerability**
do GitHub quando disponível ou contate o mantenedor por um canal privado já conhecido.

## Se uma credencial for exposta

1. Revogue ou rotacione a credencial imediatamente.
2. Verifique logs e uso indevido no provedor.
3. Remova o segredo dos arquivos e do histórico antes de qualquer publicação.
4. Considere o valor comprometido mesmo que o commit tenha sido apagado.
