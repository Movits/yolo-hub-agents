---
id: empresa-modelo.company.profile
agent: empresa-modelo
type: company
status: approved
owner: yolo-hub
sensitivity: public-business
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: config/company.example.json
---

# Empresa Modelo

> Dados totalmente fictícios para testes.

A Empresa Modelo oferece consultoria e soluções digitais para pequenas empresas. Ajuda a organizar
atendimento, vendas e processos digitais.

- Horário: segunda a sexta, das 9h às 18h.
- Fuso: `America/Sao_Paulo`.
- Endereço fictício: Avenida Exemplo, 100, São Paulo - SP.
- Atendimento remoto: todo o Brasil.
- E-mail fictício: `contato@empresa-modelo.example`.
- Telefone fictício: `(11) 0000-0000`.
- Emite nota fiscal para todos os serviços contratados.

Relacionados: [[agents/empresa-modelo/knowledge/services]] e
[[agents/empresa-modelo/knowledge/policies]].

## Dados executáveis

```json brain-runtime
{
  "schemaVersion": "1.0",
  "kind": "company",
  "value": {
    "prototype": true,
    "notice": "DADOS TOTALMENTE FICTÍCIOS PARA TESTES. Substitua este arquivo antes de produção.",
    "company": {
      "name": "Empresa Modelo",
      "industry": "consultoria e soluções digitais para pequenas empresas",
      "description": "Ajudamos pequenas empresas a organizar atendimento, vendas e processos digitais.",
      "businessHours": "segunda a sexta, das 9h às 18h",
      "timezone": "America/Sao_Paulo",
      "address": "Avenida Exemplo, 100, São Paulo - SP",
      "email": "contato@empresa-modelo.example",
      "humanPhone": "(11) 0000-0000",
      "remoteService": "Atendemos todo o Brasil remotamente.",
      "invoice": "Emitimos nota fiscal para todos os serviços contratados."
    }
  }
}
```
