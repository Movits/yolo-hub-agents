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

export function findFaq(
  message: string,
  knowledge: BusinessKnowledge
): { faq: FaqEntry; answer: string; score: number } | null {
  const inputTokens = tokens(message);
  if (inputTokens.size === 0) return null;
  const routingOnly = new Set(["ajuda", "atendimento", "menu", "servico", "servicos", "suporte"]);
  if (inputTokens.size === 1 && [...inputTokens].some((token) => routingOnly.has(token))) {
    return null;
  }
  let best: { faq: FaqEntry; score: number } | null = null;

  for (const faq of knowledge.faqs) {
    for (const question of faq.questions) {
      const normalizedMessage = normalizeText(message);
      const normalizedQuestion = normalizeText(question);
      const containment =
        normalizedMessage.includes(normalizedQuestion) ||
        (inputTokens.size >= 2 && normalizedQuestion.includes(normalizedMessage))
          ? 0.95
          : 0;
      const score = Math.max(containment, jaccard(inputTokens, tokens(question)));
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
