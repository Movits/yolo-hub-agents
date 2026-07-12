---
id: empresa-modelo.workflow.lead
agent: empresa-modelo
type: workflow
status: approved
owner: yolo-hub
sensitivity: internal
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: src/application/agent.ts
---

# Captura de lead

1. Pedir consentimento antes de coletar dados.
2. Coletar nome, empresa, necessidade e melhor período de contato.
3. Exibir um resumo e pedir confirmação.
4. Registrar somente após `SIM`.
5. Informar o protocolo e que o retorno humano não é instantâneo.

Se o consentimento for negado, encerrar sem criar lead. Nunca coletar senha, cartão ou documento.
