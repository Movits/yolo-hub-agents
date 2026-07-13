---
id: empresa-modelo.faq.core
agent: empresa-modelo
type: faq
status: approved
owner: yolo-hub
sensitivity: public-business
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: config/company.example.json
---

# Perguntas frequentes

## Quais são as formas de pagamento?

Pix, cartão ou boleto.

## O atendimento é remoto?

Sim. O atendimento fictício cobre todo o Brasil remotamente.

## A empresa emite nota fiscal?

Sim, para todos os serviços contratados.

## Qual é o horário?

Segunda a sexta, das 9h às 18h, no fuso `America/Sao_Paulo`.

## Como falar por e-mail ou telefone?

Use apenas os contatos fictícios descritos em [[agents/empresa-modelo/knowledge/company]].

## Dados executáveis

```json brain-runtime
{
  "schemaVersion": "1.0",
  "kind": "faqs",
  "value": [
    {
      "id": "company_description",
      "questions": ["o que a empresa faz", "com o que voces trabalham", "quem sao voces"],
      "answer": "A {company.name} atua com {company.industry}. {company.description}"
    },
    {
      "id": "business_hours",
      "questions": ["qual o horario de atendimento", "que horas voces abrem", "voces atendem hoje"],
      "answer": "Nosso horário de atendimento é {company.businessHours}, no fuso {company.timezone}."
    },
    {
      "id": "address",
      "questions": ["onde voces ficam", "qual o endereco", "onde fica a empresa"],
      "answer": "Nosso endereço de exemplo é {company.address}. {company.remoteService}"
    },
    {
      "id": "payment",
      "questions": ["quais formas de pagamento", "aceita pix", "posso pagar no boleto"],
      "answer": "{policies.paymentMethods}"
    },
    {
      "id": "cancellation",
      "questions": ["como cancelar", "qual a politica de cancelamento", "quero cancelar meu plano", "quero sair do meu plano"],
      "answer": "{policies.cancellation}"
    },
    {
      "id": "support_sla",
      "questions": ["qual o prazo do suporte", "quanto demora o suporte", "quando vao me responder"],
      "answer": "{policies.supportResponseTime}"
    },
    {
      "id": "remote",
      "questions": ["atendem remoto", "atendem todo brasil", "o atendimento e online"],
      "answer": "{company.remoteService}"
    },
    {
      "id": "invoice",
      "questions": ["emite nota fiscal", "tem nota fiscal", "vocês fornecem nf"],
      "answer": "{company.invoice}"
    },
    {
      "id": "contact_email",
      "questions": ["qual o email de contato", "qual o email", "como falar por email"],
      "answer": "Nosso e-mail de contato é {company.email}."
    },
    {
      "id": "human_phone",
      "questions": ["qual o telefone de contato", "qual o telefone", "numero para contato"],
      "answer": "O telefone de contato configurado é {company.humanPhone}."
    }
  ]
}
```
