import { BusinessAgent } from "./application/agent.js";
import type { LlmResponder, OutboundMessenger } from "./application/ports.js";
import { OpenAiResponder } from "./adapters/llm/openai-responder.js";
import { MetaWhatsAppClient } from "./adapters/whatsapp/meta-client.js";
import { loadCompanyConfig } from "./config/company.js";
import { loadEnv, type AppEnv } from "./config/env.js";
import type { BusinessKnowledge } from "./domain/types.js";
import { MemoryStore } from "./infrastructure/memory-store.js";

export interface RuntimeOptions {
  env?: AppEnv;
  knowledge?: BusinessKnowledge;
  store?: MemoryStore;
  llm?: LlmResponder | null;
  messenger?: OutboundMessenger;
}

export function createRuntime(options: RuntimeOptions = {}): {
  env: AppEnv;
  knowledge: BusinessKnowledge;
  store: MemoryStore;
  llm: LlmResponder | undefined;
  messenger: OutboundMessenger;
  agent: BusinessAgent;
} {
  const env = options.env ?? loadEnv();
  const knowledge = options.knowledge ?? loadCompanyConfig(env.COMPANY_CONFIG_PATH);
  const store = options.store ?? new MemoryStore();
  const llm =
    options.llm === null
      ? undefined
      : options.llm ??
        (env.OPENAI_API_KEY
          ? new OpenAiResponder(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_TIMEOUT_MS)
          : undefined);
  const messenger =
    options.messenger ??
    new MetaWhatsAppClient({
      enabled: env.WHATSAPP_SEND_ENABLED,
      graphVersion: env.META_GRAPH_VERSION,
      ...(env.WHATSAPP_ACCESS_TOKEN ? { accessToken: env.WHATSAPP_ACCESS_TOKEN } : {}),
      ...(env.WHATSAPP_PHONE_NUMBER_ID
        ? { defaultPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID }
        : {})
    });
  const agent = new BusinessAgent(knowledge, store, llm);

  return { env, knowledge, store, llm, messenger, agent };
}
