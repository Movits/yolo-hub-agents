# Template de agente

Copie esta pasta para `agents/<agent-id>/`, substitua os identificadores e use os modelos em
`brain/_templates/`. Cada agente deve ter:

- `agent.json`: identidade, herança e raízes de conteúdo;
- `knowledge/`: empresa, serviços, FAQs, políticas e suporte;
- `workflows/`: ações conversacionais determinísticas;
- `evals/`: casos esperados, adversariais e de isolamento.

Não coloque segredos no manifesto. Integrações devem apontar apenas para nomes de variáveis ou
referências de um secret manager.
