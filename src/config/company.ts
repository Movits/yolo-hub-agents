import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { BusinessKnowledge } from "../domain/types.js";

export const businessKnowledgeSchema = z.object({
  agentId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  prototype: z.boolean(),
  notice: z.string().min(1),
  assistant: z.object({
    name: z.string().min(1),
    tone: z.string().min(1),
    humanResponseSla: z.string().min(1)
  }).strict(),
  company: z.object({
    name: z.string().min(1),
    industry: z.string().min(1),
    description: z.string().min(1),
    businessHours: z.string().min(1),
    timezone: z.string().min(1),
    address: z.string().min(1),
    email: z.string().min(1),
    humanPhone: z.string().min(1),
    remoteService: z.string().min(1),
    invoice: z.string().min(1)
  }).strict(),
  services: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      price: z.string().min(1)
    }).strict()
  ).min(1),
  policies: z.object({
    paymentMethods: z.string().min(1),
    cancellation: z.string().min(1),
    supportResponseTime: z.string().min(1),
    privacyContact: z.string().min(1)
  }).strict(),
  faqs: z.array(
    z.object({
      id: z.string().min(1),
      questions: z.array(z.string().min(1)).min(1),
      answer: z.string().min(1)
    }).strict()
  ),
  supportProcedures: z.array(
    z.object({
      id: z.string().min(1),
      triggers: z.array(z.string().min(1)).min(1),
      steps: z.array(z.string().min(1)).min(1)
    }).strict()
  )
}).strict();

export function parseBusinessKnowledge(value: unknown): BusinessKnowledge {
  return businessKnowledgeSchema.parse(value);
}

export function loadCompanyConfig(path: string): BusinessKnowledge {
  const absolutePath = resolve(path);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return parseBusinessKnowledge(parsed);
}

export function renderTemplate(template: string, knowledge: BusinessKnowledge): string {
  const values: Record<string, string> = {
    "company.name": knowledge.company.name,
    "company.industry": knowledge.company.industry,
    "company.description": knowledge.company.description,
    "company.businessHours": knowledge.company.businessHours,
    "company.timezone": knowledge.company.timezone,
    "company.address": knowledge.company.address,
    "company.email": knowledge.company.email,
    "company.humanPhone": knowledge.company.humanPhone,
    "company.remoteService": knowledge.company.remoteService,
    "company.invoice": knowledge.company.invoice,
    "policies.paymentMethods": knowledge.policies.paymentMethods,
    "policies.cancellation": knowledge.policies.cancellation,
    "policies.supportResponseTime": knowledge.policies.supportResponseTime,
    "policies.privacyContact": knowledge.policies.privacyContact
  };

  return template.replace(/\{([^}]+)\}/g, (full, key: string) => values[key] ?? full);
}
