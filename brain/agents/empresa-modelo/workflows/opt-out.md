---
id: empresa-modelo.workflow.opt-out
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

# Opt-out e retomada

- `STOP` ou pedido equivalente desativa mensagens automáticas.
- Depois do opt-out, mensagens comuns não recebem resposta.
- `VOLTAR` inicia confirmação de reativação.
- Somente `SIM` reativa o atendimento.
- O estado de opt-out precisa ser durável antes de uso com clientes reais.
