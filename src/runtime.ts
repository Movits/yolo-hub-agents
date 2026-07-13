import { OpenAiResponder } from "./adapters/llm/openai-responder.js";
import { MetaWhatsAppClient } from "./adapters/whatsapp/meta-client.js";
import { BusinessAgent } from "./application/agent.js";
import type { LlmResponder, OutboundMessenger, SessionStore } from "./application/ports.js";
import { parseTrustedReleaseKeys } from "./brain/release-signature.js";
import { loadCompanyConfig } from "./config/company.js";
import { loadEnv, type AppEnv } from "./config/env.js";
import {
  createDevelopmentRelease,
  loadPinnedKnowledgeRelease,
  type KnowledgeRelease
} from "./config/release.js";
import type { BusinessKnowledge } from "./domain/types.js";
import { DEFAULT_TENANT_CONTEXT, type TenantContext } from "./domain/tenant.js";
import { MemoryStore } from "./infrastructure/memory-store.js";
import { SqliteStore } from "./infrastructure/sqlite-store.js";
import { loadTenantRegistry, type TenantRegistry } from "./tenancy/registry.js";

export interface RuntimeOptions {
  env?: AppEnv;
  knowledge?: BusinessKnowledge;
  release?: KnowledgeRelease;
  store?: SessionStore;
  llm?: LlmResponder | null;
  messenger?: OutboundMessenger;
  tenantContext?: TenantContext;
}

export interface Runtime {
  env: AppEnv;
  knowledge: BusinessKnowledge;
  release: KnowledgeRelease;
  store: SessionStore;
  llm: LlmResponder | undefined;
  messenger: OutboundMessenger;
  tenantContext: TenantContext;
  agent: BusinessAgent;
  registry: TenantRegistry | undefined;
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const env = options.env ?? loadEnv();
  const trustedPublicKeys = parseTrustedReleaseKeys(env.RELEASE_TRUSTED_PUBLIC_KEYS);
  const store =
    options.store ??
    (env.STORAGE_DRIVER === "sqlite" ? new SqliteStore(env.SQLITE_PATH) : new MemoryStore());
  const llm =
    options.llm === null
      ? undefined
      : options.llm ??
        (env.OPENAI_API_KEY
          ? new OpenAiResponder(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_TIMEOUT_MS)
          : undefined);
  const selectorValues = [
    env.AGENT_ID,
    env.AGENT_RELEASE_VERSION,
    env.AGENT_RELEASE_MANIFEST_SHA256
  ];
  const selectorConfigured = selectorValues.some(Boolean);
  const selectorComplete = selectorValues.every(Boolean);
  let release: KnowledgeRelease;
  let registry: TenantRegistry | undefined;
  let tenantContext: TenantContext;
  let agent: BusinessAgent;

  if (options.knowledge && options.release) {
    throw new Error("Não combine overrides de knowledge e release.");
  }
  if (env.NODE_ENV === "production" && (options.knowledge || options.release)) {
    throw new Error("Produção não permite override direto de conhecimento ou release.");
  }

  if (env.TENANT_REGISTRY_PATH) {
    if (options.release || options.knowledge || options.tenantContext || selectorConfigured) {
      throw new Error("Registro de tenants não pode ser combinado com overrides ou seletor singleton.");
    }
    registry = loadTenantRegistry(env.TENANT_REGISTRY_PATH, {
      releasesRoot: env.AGENT_RELEASES_ROOT,
      store,
      ...(llm ? { llm } : {}),
      requireReleaseSignature: env.REQUIRE_RELEASE_SIGNATURE,
      trustedPublicKeys
    });
    const defaultRuntime = registry.byTenantId(env.DEFAULT_TENANT_ID);
    if (!defaultRuntime) {
      throw new Error(`DEFAULT_TENANT_ID não encontrado no registro: ${env.DEFAULT_TENANT_ID}`);
    }
    release = defaultRuntime.release;
    tenantContext = defaultRuntime.context;
    agent = defaultRuntime.agent;
  } else {
    if (options.release) {
      if (selectorConfigured) {
        throw new Error("Não combine release injetada com seletor de ambiente.");
      }
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
        expectedManifestSha256: env.AGENT_RELEASE_MANIFEST_SHA256!,
        requireSignature: env.REQUIRE_RELEASE_SIGNATURE,
        trustedPublicKeys
      });
    } else {
      if (env.NODE_ENV === "production") {
        throw new Error("Produção exige uma release de conhecimento explicitamente fixada.");
      }
      release = createDevelopmentRelease(
        options.knowledge ?? loadCompanyConfig(env.COMPANY_CONFIG_PATH)
      );
    }

    tenantContext =
      options.tenantContext ??
      (release.identity.agentId === DEFAULT_TENANT_CONTEXT.agentId
        ? DEFAULT_TENANT_CONTEXT
        : { tenantId: release.identity.agentId, agentId: release.identity.agentId });
    agent = new BusinessAgent(tenantContext, release, store, llm);
  }

  const knowledge = release.knowledge;
  if (tenantContext.agentId !== knowledge.agentId) {
    throw new Error("TenantContext.agentId deve corresponder ao conhecimento carregado.");
  }
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

  return { env, knowledge, release, store, llm, messenger, tenantContext, agent, registry };
}
