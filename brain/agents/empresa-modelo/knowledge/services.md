---
id: empresa-modelo.services.catalog
agent: empresa-modelo
type: services
status: approved
owner: yolo-hub
sensitivity: public-business
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: config/company.example.json
---

# Serviços e preços

## Plano Essencial

- Preço fictício: R$ 199/mês.
- Escopo: organização inicial do atendimento e dos processos.

## Plano Profissional

- Preço fictício: R$ 499/mês.
- Escopo: automação e acompanhamento para equipes em crescimento.

## Plano Personalizado

- Preço: sob consulta.
- Escopo: desenhado conforme a operação da empresa.

Não confirmar descontos, condições especiais ou itens fora desta nota. Quando a pergunta exigir uma
proposta personalizada, seguir [[agents/empresa-modelo/workflows/lead]].

## Dados executáveis

```json brain-runtime
{
  "schemaVersion": "1.0",
  "kind": "services",
  "value": [
    {
      "id": "essencial",
      "name": "Plano Essencial",
      "description": "Organização inicial do atendimento e dos processos.",
      "price": "R$ 199/mês"
    },
    {
      "id": "profissional",
      "name": "Plano Profissional",
      "description": "Automação e acompanhamento para equipes em crescimento.",
      "price": "R$ 499/mês"
    },
    {
      "id": "personalizado",
      "name": "Plano Personalizado",
      "description": "Escopo desenhado de acordo com a operação da empresa.",
      "price": "sob consulta"
    }
  ]
}
```
