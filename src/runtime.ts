import { BusinessAgent } from "./application/agent.js";
import type { LlmResponder, OutboundMessenger } from "./application/ports.js";
import { OpenAiResponder } from "./adapters/llm/openai-responder.js";
import { MetaWhatsAppClient } from "./adapters/whatsapp/meta-client.js";
import { loadCompanyConfig } from "./config/company.js";
import { loadEnv, type AppEnv } from "./config/env.js";
import {
  createDevelopmentRelease,
  loadPinnedKnowledgeRelease,
  type KnowledgeRelease
} from "./config/release.js";
import type { BusinessKnowledge } from "./domain/types.js";
import {
  DEFAULT_TENANT_CONTEXT,
  type TenantContext
} from "./domain/tenant.js";
import { MemoryStore } from "./infrastructure/memory-store.js";

export interface RuntimeOptions {
  env?: AppEnv;
  knowledge?: BusinessKnowledge;
  release?: KnowledgeRelease;
  store?: MemoryStore;
  llm?: LlmResponder | null;
  messenger?: OutboundMessenger;
  tenantContext?: TenantContext;
}

export function createRuntime(options: RuntimeOptions = {}): {
  env: AppEnv;
  knowledge: BusinessKnowledge;
  release: KnowledgeRelease;
  store: MemoryStore;
  llm: LlmResponder | undefined;
  messenger: OutboundMessenger;
  tenantContext: TenantContext;
  agent: BusinessAgent;
} {
  const env = options.env ?? loadEnv();
  const selectorValues = [
    env.AGENT_ID,
    env.AGENT_RELEASE_VERSION,
    env.AGENT_RELEASE_MANIFEST_SHA256
  ];
  const selectorConfigured = selectorValues.some(Boolean);
  const selectorComplete = selectorValues.every(Boolean);
  let release: KnowledgeRelease;

  if (options.knowledge && options.release) {
    throw new Error("Não combine overrides de knowledge e release.");
  }
  if (env.NODE_ENV === "production" && (options.knowledge || options.release)) {
    throw new Error("Produção não permite override direto de conhecimento ou release.");
  }
  if (options.release) {
    if (selectorConfigured) throw new Error("Não combine release injetada com seletor de ambiente.");
    release = options.release;
  } else if (selectorConfigured) {
    if (!selectorComplete) {
      throw new Error(
        "Seleção de release incompleta: informe AGENT_ID, AGENT_RELEASE_VERSION e AGENT_RELEASE_MANIFEST_SHA256."
      );
    }
    release = loadPinnedKnowledgeRelease({
      releasesRoot: env.AGENT_RELEASES_ROOT,
      agentId: env.AGENT_ID!,
      version: env.AGENT_RELEASE_VERSION!,
      expectedManifestSha256: env.AGENT_RELEASE_MANIFEST_SHA256!
    });
  } else {
    if (env.NODE_ENV === "production") {
      throw new Error("Produção exige uma release de conhecimento explicitamente fixada.");
    }
    release = createDevelopmentRelease(
      options.knowledge ?? loadCompanyConfig(env.COMPANY_CONFIG_PATH)
    );
  }

  const knowledge = release.knowledge;
  const tenantContext =
    options.tenantContext ??
    (release.identity.agentId === DEFAULT_TENANT_CONTEXT.agentId
      ? DEFAULT_TENANT_CONTEXT
      : { tenantId: release.identity.agentId, agentId: release.identity.agentId });
  if (tenantContext.agentId !== knowledge.agentId) {
    throw new Error("TenantContext.agentId deve corresponder ao conhecimento carregado.");
  }
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
  const agent = new BusinessAgent(tenantContext, release, store, llm);

  return { env, knowledge, release, store, llm, messenger, tenantContext, agent };
}
