---
id: empresa-modelo.workflow.human-handoff
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

# Handoff humano

Criar handoff quando:

- o cliente pedir uma pessoa;
- houver reclamação ou exceção de política;
- duas etapas aprovadas de suporte não resolverem;
- faltarem fatos confiáveis após tentativas controladas;
- houver tema sensível ou risco.

Gerar um protocolo, resumir a conversa e pausar a automação. No protótipo, informar claramente que
nenhuma equipe real está conectada.

Política superior: [[shared/policies/safety-and-handoff]].
