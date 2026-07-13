import { describe, expect, it } from "vitest";
import {
  includesAny,
  isConsentPositive,
  isNegative,
  isPositive,
  normalizeText
} from "../src/application/text.js";

describe("normalizeText", () => {
  it.each([
    ["vcs abre hj?", "voces abre hoje"],
    ["q horas fecha?", "que horas fecha"],
    ["qnt custa isso?", "quanto custa isso"],
    ["ta aberto agr?", "esta aberto agora"],
    ["aceita pixx?", "aceita pix"],
    ["tem entrga pra amanh\u00e3?", "tem entrega pra amanha"],
    ["meu pedio ainda n chego", "meu pedido ainda nao chegou"],
    ["keria fala com atendente", "queria falar com atendente"],
    ["tem disconto no dinhero?", "tem desconto no dinheiro"],
    ["comprei errado cm fa\u00e7o", "comprei errado como faco"],
    ["naum qro mais msg", "nao quero mais mensagem"],
    ["parem d me manda msg", "parem de me mandar mensagem"]
  ])("normaliza chat PT-BR sem aproxima\u00e7\u00e3o global: %s", (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it("preserva usos leg\u00edtimos de aliases contextuais", () => {
    expect(normalizeText("eu chego amanh\u00e3")).toBe("eu chego amanha");
    expect(normalizeText("o produto mede 10 cm")).toBe("o produto mede 10 cm");
    expect(normalizeText("ela fala com clareza")).toBe("ela fala com clareza");
    expect(normalizeText("o modelo D est\u00e1 dispon\u00edvel")).toBe("o modelo d esta disponivel");
  });

  it("permite que aliases sejam comparados por palavras completas", () => {
    expect(includesAny("qnt custa no pixx?", ["quanto custa"])).toBe(true);
    expect(includesAny("vcs abre hj?", ["abre hoje"])).toBe(true);
  });
});

describe("isPositive", () => {
  it.each([
    "SIM",
    "s",
    "claro que sim",
    "com certeza",
    "pode sim",
    "quero sim"
  ])("aceita confirma\u00e7\u00e3o inequ\u00edvoca: %s", (input) => {
    expect(isPositive(input)).toBe(true);
  });

  it.each([
    "talvez",
    "acho que sim",
    "pode ser",
    "quem sabe",
    "sim, mas n\u00e3o tenho certeza",
    "depois eu confirmo",
    "pode entrar em contato com outra pessoa"
  ])("n\u00e3o trata resposta amb\u00edgua como consentimento: %s", (input) => {
    expect(isPositive(input)).toBe(false);
  });

  it.each([
    "concordo",
    "aceito",
    "autorizo",
    "autorizo o contato",
    "pode entrar em contato comigo",
    "Sim, pode entrar em contato comigo!",
    "pode me contatar"
  ])("aceita consentimento apenas no contexto de coleta: %s", (input) => {
    expect(isConsentPositive(input)).toBe(true);
    expect(isPositive(input)).toBe(false);
  });
});

describe("isNegative", () => {
  it.each([
    "N\u00c3O",
    "n",
    "prefiro n\u00e3o",
    "n\u00e3o, obrigado",
    "agora n\u00e3o",
    "de jeito nenhum",
    "n\u00e3o autorizo",
    "n\u00e3o entre em contato comigo",
    "n\u00e3o quero receber mensagens",
    "quero cancelar"
  ])("aceita recusa inequ\u00edvoca: %s", (input) => {
    expect(isNegative(input)).toBe(true);
  });

  it.each(["talvez n\u00e3o", "acho que n\u00e3o", "n\u00e3o sei", "posso responder depois?"]) (
    "n\u00e3o converte d\u00favida em recusa definitiva: %s",
    (input) => {
      expect(isNegative(input)).toBe(false);
    }
  );
});
