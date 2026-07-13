import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findFaq } from "../src/application/knowledge.js";
import { loadCompanyConfig } from "../src/config/company.js";

const knowledge = loadCompanyConfig(resolve("config/company.example.json"));

describe("findFaq", () => {
  it("rejeita sobreposição de um único token genérico", () => {
    expect(findFaq("Como que faz?", knowledge)).toBeNull();
    expect(findFaq("Isso faz sentido?", knowledge)).toBeNull();

    const knowledgeWithOneWordQuestion = {
      ...knowledge,
      faqs: [{ id: "generic", questions: ["faz"], answer: "Resposta genérica" }]
    };
    expect(findFaq("Como que faz?", knowledgeWithOneWordQuestion)).toBeNull();
  });

  it("aceita duas palavras informativas compartilhadas", () => {
    expect(findFaq("horário atendimento", knowledge)?.faq.id).toBe("business_hours");
    expect(findFaq("formas pagamento", knowledge)?.faq.id).toBe("payment");
  });

  it("preserva consultas factuais curtas e exatas", () => {
    expect(findFaq("endereço?", knowledge)?.faq.id).toBe("address");
    expect(findFaq("pix", knowledge)?.faq.id).toBe("payment");
    expect(findFaq("horário", knowledge)?.faq.id).toBe("business_hours");
    expect(findFaq("Como cancelar", knowledge)?.faq.id).toBe("cancellation");
  });

  it.each([
    "cancelamento pedido",
    "pagamento pedido",
    "pix errado",
    "endereço cobrança"
  ])("não usa um único token forte quando há outro qualificador: %s", (message) => {
    expect(findFaq(message, knowledge)).toBeNull();
  });

  it("normaliza acentos, caixa e pontuação pela camada de texto", () => {
    expect(findFaq("QUAL É O ENDEREÇO???", knowledge)?.faq.id).toBe("address");
    expect(findFaq("Quais FORMAS de PAGAMENTO!!!", knowledge)?.faq.id).toBe("payment");
    expect(findFaq("aceita pixx?", knowledge)?.faq.id).toBe("payment");
  });

  it("aceita uma pergunta completa dentro de uma mensagem maior", () => {
    expect(
      findFaq("Por favor, qual o endereço? Preciso chegar hoje.", knowledge)?.faq.id
    ).toBe("address");
  });

  it("mantém comandos de roteamento fora das FAQs", () => {
    expect(findFaq("ajuda", knowledge)).toBeNull();
    expect(findFaq("suporte", knowledge)).toBeNull();
  });
});
