import { renderTemplate } from "../config/company.js";
import type { BusinessKnowledge, FaqEntry, SupportProcedure } from "../domain/types.js";
import { normalizeText, tokens } from "./text.js";

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection;
}

function containsPhrase(container: string, phrase: string): boolean {
  if (!container || !phrase) return false;
  return ` ${container} `.includes(` ${phrase} `);
}

// These nouns are unambiguous factual destinations even when the customer sends
// only one or two words (for example, "endereço?" or "pix"). Generic verbs such
// as "faz" deliberately stay out of this list because they produce unsafe matches.
const strongFactTokens = new Set([
  "boleto",
  "cancelamento",
  "email",
  "endereco",
  "horario",
  "nf",
  "nota",
  "pagamento",
  "pix",
  "remoto",
  "telefone"
]);

function isStrongShortQuery(inputTokens: Set<string>, questionTokens: Set<string>): boolean {
  if (inputTokens.size !== 1) return false;
  return [...inputTokens].some(
    (token) => strongFactTokens.has(token) && questionTokens.has(token)
  );
}

export function findFaq(
  message: string,
  knowledge: BusinessKnowledge
): { faq: FaqEntry; answer: string; score: number } | null {
  const normalizedMessage = normalizeText(message);
  const inputTokens = tokens(message);
  if (inputTokens.size === 0) return null;
  const routingOnly = new Set(["ajuda", "atendimento", "menu", "servico", "servicos", "suporte"]);
  if (inputTokens.size === 1 && [...inputTokens].some((token) => routingOnly.has(token))) {
    return null;
  }
  let best: { faq: FaqEntry; score: number } | null = null;

  for (const faq of knowledge.faqs) {
    for (const question of faq.questions) {
      const normalizedQuestion = normalizeText(question);
      const questionTokens = tokens(question);
      const exact = normalizedMessage === normalizedQuestion;
      const fullQuestionInMessage =
        normalizedQuestion.split(" ").length >= 2 &&
        containsPhrase(normalizedMessage, normalizedQuestion);
      const informativeInputInQuestion =
        inputTokens.size >= 2 && containsPhrase(normalizedQuestion, normalizedMessage);
      const sharedTokens = intersectionSize(inputTokens, questionTokens);

      // A FAQ is eligible only with strong evidence. In particular, one generic
      // shared token must never turn "Como que faz?" into the company description.
      let score = 0;
      if (exact) score = 1;
      else if (fullQuestionInMessage) score = 0.95;
      else if (informativeInputInQuestion) score = 0.9;
      else if (sharedTokens >= 2) score = jaccard(inputTokens, questionTokens);
      else if (isStrongShortQuery(inputTokens, questionTokens)) score = 0.8;

      if (!best || score > best.score) best = { faq, score };
    }
  }

  if (!best || best.score < 0.45) return null;
  return {
    ...best,
    answer: renderTemplate(best.faq.answer, knowledge)
  };
}

export function findSupportProcedure(
  description: string,
  knowledge: BusinessKnowledge
): SupportProcedure | null {
  const normalized = normalizeText(description);
  return (
    knowledge.supportProcedures.find((procedure) =>
      procedure.triggers.some((trigger) => normalized.includes(normalizeText(trigger)))
    ) ?? null
  );
}

export function formatServices(knowledge: BusinessKnowledge): string {
  return knowledge.services
    .map((service) => `• *${service.name}* — ${service.price}\n  ${service.description}`)
    .join("\n");
}
