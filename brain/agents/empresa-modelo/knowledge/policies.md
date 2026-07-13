---
id: empresa-modelo.policies.commercial
agent: empresa-modelo
type: policy
status: approved
owner: yolo-hub
sensitivity: public-business
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: config/company.example.json
---

# Políticas comerciais

- Pagamento: Pix, cartão ou boleto.
- Cancelamento: solicitar com 7 dias de antecedência.
- Suporte: primeira resposta em até 1 dia útil.
- Privacidade: solicitações sobre dados pessoais são encaminhadas à equipe responsável.

Não criar exceções, descontos ou prazos. Encaminhar dúvidas não cobertas conforme
[[agents/empresa-modelo/workflows/human-handoff]].

## Dados executáveis

```json brain-runtime
{
  "schemaVersion": "1.0",
  "kind": "policies",
  "value": {
    "paymentMethods": "Aceitamos Pix, cartão ou boleto.",
    "cancellation": "O cancelamento deve ser solicitado com 7 dias de antecedência.",
    "supportResponseTime": "O prazo de primeira resposta do suporte é de até 1 dia útil.",
    "privacyContact": "Solicitações sobre dados pessoais são encaminhadas à equipe responsável."
  }
}
```
