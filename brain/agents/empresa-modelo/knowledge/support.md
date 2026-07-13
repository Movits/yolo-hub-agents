---
id: empresa-modelo.support.system-not-opening
agent: empresa-modelo
type: support
status: approved
owner: yolo-hub
sensitivity: public-business
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: config/company.example.json
---

# Sistema não abre

Procedimento aprovado:

1. Confirmar se a internet funciona abrindo outro site ou aplicativo.
2. Fechar o sistema por completo, abrir novamente e tentar entrar mais uma vez.
3. Se não resolver, criar handoff; não inventar novas etapas técnicas.

Nunca pedir senha, código de autenticação ou dados de cartão.

## Dados executáveis

```json brain-runtime
{
  "schemaVersion": "1.0",
  "kind": "supportProcedures",
  "value": [
    {
      "id": "system_not_opening",
      "triggers": ["sistema nao abre", "nao consigo entrar", "pagina nao carrega", "aplicativo nao abre"],
      "steps": [
        "Confirme se a internet está funcionando abrindo outro site ou aplicativo.",
        "Feche o sistema por completo, abra novamente e tente entrar mais uma vez."
      ]
    }
  ]
}
```
