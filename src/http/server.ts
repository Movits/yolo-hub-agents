import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import { z } from "zod";
import type { RuntimeOptions } from "../runtime.js";
import { createRuntime } from "../runtime.js";
import { extractWhatsAppMessages, extractWhatsAppStatuses } from "../adapters/whatsapp/payload.js";
import { verifyMetaSignature } from "../adapters/whatsapp/signature.js";
import { tenantScopeKey, type TenantContext } from "../domain/tenant.js";
import type { TenantRuntime } from "../tenancy/registry.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const simulateSchema = z.object({
  userId: z.string().min(1).max(100).default("simulator-user"),
  message: z.string().min(1).max(4_000),
  messageId: z.string().min(1).max(200).optional(),
  messageType: z.string().min(1).max(50).default("text")
});

const resetSchema = z.object({ userId: z.string().min(1).max(100).default("simulator-user") });
const tenantParamsSchema = z.object({ tenantId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) });

function parseTenantTokens(value: string | undefined): Readonly<Record<string, string>> {
  if (!value) return {};
  return z
    .record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/), z.string().min(32))
    .parse(JSON.parse(value) as unknown);
}

function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export function buildServer(options: RuntimeOptions = {}): FastifyInstance {
  const runtime = createRuntime(options);
  const { env, knowledge, store, agent, messenger, tenantContext } = runtime;
  const production = env.NODE_ENV === "production";
  const loopbackHost = ["127.0.0.1", "localhost", "::1"].includes(env.HOST);
  const localSimulatorEnabled = !production && env.ENABLE_SIMULATOR;
  const simulatorEnabled = localSimulatorEnabled || env.DEMO_HOSTED;
  const tenantTokens = parseTenantTokens(env.SIMULATOR_TENANT_TOKENS);
  if (runtime.registry && simulatorEnabled) {
    for (const tenantRuntime of runtime.registry.list()) {
      if (!tenantTokens[tenantRuntime.registration.simulator.keyId]) {
        throw new Error(
          `Token do simulador ausente para keyId ${tenantRuntime.registration.simulator.keyId}.`
        );
      }
    }
  }
  if (
    !loopbackHost &&
    (env.ENABLE_DEBUG_ENDPOINTS || (env.ENABLE_SIMULATOR && !env.DEMO_HOSTED))
  ) {
    throw new Error("Simulador local e debug exigem um HOST de loopback.");
  }
  if (env.DEMO_HOSTED) {
    if (!production) {
      throw new Error("DEMO_HOSTED=true exige NODE_ENV=production.");
    }
    if (env.ENABLE_DEBUG_ENDPOINTS) {
      throw new Error("DEMO_HOSTED=true nao permite ENABLE_DEBUG_ENDPOINTS=true.");
    }
    if (!env.SIMULATOR_API_TOKEN || env.SIMULATOR_API_TOKEN.length < 32) {
      throw new Error("DEMO_HOSTED=true exige SIMULATOR_API_TOKEN com pelo menos 32 caracteres.");
    }
    if (env.CORS_ALLOWED_ORIGINS.length === 0) {
      throw new Error("DEMO_HOSTED=true exige ao menos uma origem em CORS_ALLOWED_ORIGINS.");
    }
  }
  const productionWhatsApp = production && !env.DEMO_HOSTED;
  const whatsappTenantRuntimes = runtime.registry
    ? runtime.registry
        .list()
        .filter((tenantRuntime) => tenantRuntime.registration.whatsapp?.enabled)
    : [];
  if (
    (productionWhatsApp || env.WHATSAPP_SEND_ENABLED || env.REQUIRE_WEBHOOK_SIGNATURE) &&
    !env.META_APP_SECRET
  ) {
    throw new Error("WhatsApp em producao, envio ou assinatura obrigatoria exige META_APP_SECRET.");
  }
  if (
    !runtime.registry &&
    (productionWhatsApp || env.WHATSAPP_SEND_ENABLED) &&
    (!env.WHATSAPP_WABA_ID || !env.WHATSAPP_PHONE_NUMBER_ID)
  ) {
    throw new Error("WhatsApp em producao ou envio exige WHATSAPP_WABA_ID e WHATSAPP_PHONE_NUMBER_ID.");
  }
  if (runtime.registry && productionWhatsApp && whatsappTenantRuntimes.length === 0) {
    throw new Error("WhatsApp em produção exige ao menos um binding de tenant habilitado.");
  }
  if (production && env.WEBHOOK_PROCESSING_MODE === "async") {
    throw new Error("WEBHOOK_PROCESSING_MODE=async exige uma fila durável e não é permitido neste MVP em produção.");
  }
  if (production && messenger.enabled) {
    throw new Error(
      "Envio WhatsApp em produção permanece bloqueado até existir outbox durável e reconciliação de resultado ambíguo."
    );
  }

  const releasesForProduction = runtime.registry
    ? whatsappTenantRuntimes.map((tenantRuntime) => tenantRuntime.release)
    : [runtime.release];
  if (productionWhatsApp && releasesForProduction.some((release) => release.knowledge.prototype)) {
    throw new Error("WhatsApp em produção não permite release marcada como prototype.");
  }
  if (productionWhatsApp && store.durability !== "durable") {
    throw new Error("WhatsApp em produção exige armazenamento durável.");
  }
  if (
    productionWhatsApp &&
    releasesForProduction.some((release) => !release.identity.signatureVerified)
  ) {
    throw new Error("WhatsApp em produção exige releases assinadas por chave Ed25519 confiável.");
  }

  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    logger:
      env.LOG_LEVEL === "silent"
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: ["req.headers.authorization", "req.headers.x-hub-signature-256", "req.url"],
              censor: "[REDACTED]"
            }
          },
    bodyLimit: 3 * 1024 * 1024
  });
  app.addHook("onClose", async () => {
    store.close?.();
  });
  const outboundQueues = new Map<string, Promise<void>>();

  const enqueueOutbound = (
    context: TenantContext,
    userId: string,
    task: () => Promise<void>
  ): Promise<void> => {
    const queueKey = tenantScopeKey(context, userId);
    const previous = outboundQueues.get(queueKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    outboundQueues.set(queueKey, current);
    return current.finally(() => {
      if (outboundQueues.get(queueKey) === current) outboundQueues.delete(queueKey);
    });
  };

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody.toString("utf8")) as unknown);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  const simulatorRateLimits = new Map<string, { count: number; resetAt: number }>();
  let simulatorRateLimitChecks = 0;

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    const tenantSimulatorRequest = path.startsWith("/api/tenants/");
    const simulatorRequest =
      path === "/api/simulate" || path.startsWith("/api/simulate/") || tenantSimulatorRequest;
    const hostedHealthRequest = env.DEMO_HOSTED && path === "/health";
    if ((!simulatorRequest || !simulatorEnabled) && !hostedHealthRequest) return;

    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");

    const origin = request.headers.origin;
    const allowedCrossOrigin = origin && env.CORS_ALLOWED_ORIGINS.includes(origin);
    if (origin && env.DEMO_HOSTED && !allowedCrossOrigin) {
      return reply.code(403).send({ error: "origin_not_allowed" });
    }
    if (origin && allowedCrossOrigin) {
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        .header("Access-Control-Max-Age", "600")
        .header("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
    if (hostedHealthRequest) return;

    if (env.DEMO_HOSTED) {
      const now = Date.now();
      const existing = simulatorRateLimits.get(request.ip);
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : { count: 0, resetAt: now + env.SIMULATOR_RATE_LIMIT_WINDOW_MS };

      if (bucket.count >= env.SIMULATOR_RATE_LIMIT_MAX) {
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
        return reply
          .header("Retry-After", String(retryAfter))
          .header("X-RateLimit-Remaining", "0")
          .code(429)
          .send({ error: "rate_limit_exceeded", retryAfterSeconds: retryAfter });
      }

      bucket.count += 1;
      simulatorRateLimits.set(request.ip, bucket);
      reply
        .header("X-RateLimit-Limit", String(env.SIMULATOR_RATE_LIMIT_MAX))
        .header("X-RateLimit-Remaining", String(env.SIMULATOR_RATE_LIMIT_MAX - bucket.count));

      simulatorRateLimitChecks += 1;
      if (simulatorRateLimitChecks % 100 === 0) {
        for (const [key, value] of simulatorRateLimits) {
          if (value.resetAt <= now) simulatorRateLimits.delete(key);
        }
      }
    }

    if (env.SIMULATOR_API_TOKEN && !tenantSimulatorRequest) {
      const authorization = request.headers.authorization;
      const match = authorization?.match(/^Bearer\s+(.+)$/i);
      if (!secretsMatch(match?.[1]?.trim(), env.SIMULATOR_API_TOKEN)) {
        return reply
          .header("WWW-Authenticate", 'Bearer realm="simulator"')
          .code(401)
          .send({ error: "invalid_simulator_token" });
      }
    }
  });

  if (localSimulatorEnabled) {
    const publicDirectory = resolve("public");
    const uiHtml = readFileSync(resolve(publicDirectory, "index.html"), "utf8");
    const uiCss = readFileSync(resolve(publicDirectory, "app.css"), "utf8");
    const uiConfig = readFileSync(resolve(publicDirectory, "config.js"), "utf8");
    const uiJavaScript = readFileSync(resolve(publicDirectory, "app.js"), "utf8");
    const contentSecurityPolicy =
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";

    app.get("/", async (_request, reply) =>
      reply
        .header("Content-Security-Policy", contentSecurityPolicy)
        .header("Cache-Control", "no-store")
        .type("text/html; charset=utf-8")
        .send(uiHtml)
    );
    app.get("/app.css", async (_request, reply) =>
      reply.header("Cache-Control", "no-store").type("text/css; charset=utf-8").send(uiCss)
    );
    app.get("/config.js", async (_request, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .type("text/javascript; charset=utf-8")
        .send(uiConfig)
    );
    app.get("/app.js", async (_request, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .type("text/javascript; charset=utf-8")
        .send(uiJavaScript)
    );
    app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());
  }

  app.get("/health", async () => {
    const releaseHealth = {
      agentId: runtime.release.identity.agentId,
      releaseVersion: runtime.release.identity.version,
      manifestSha256: runtime.release.identity.manifestSha256,
      signatureVerified: runtime.release.identity.signatureVerified,
      releaseSource: runtime.release.source,
      storage: store.driver
    };
    return production && !env.DEMO_HOSTED
      ? { status: "ok", ...releaseHealth }
      : {
          status: "ok",
          service: "whatsapp-business-agent",
          mode: knowledge.prototype ? "prototype" : "configured",
          company: knowledge.company.name,
          ...releaseHealth,
          openai: runtime.llm ? "configured" : "deterministic",
          whatsappSending: messenger.enabled
        };
  });

  if (simulatorEnabled) {
    app.post("/api/simulate", async (request, reply) => {
      const parsed = simulateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }

      const result = await agent.process({
        id: parsed.data.messageId ?? `sim-${randomUUID()}`,
        userId: parsed.data.userId,
        text: parsed.data.message,
        timestamp: new Date(),
        source: "simulator",
        messageType: parsed.data.messageType
      });
      return { userId: parsed.data.userId, ...result };
    });

    app.post("/api/simulate/reset", async (request, reply) => {
      const parsed = resetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const session = store.resetSession(tenantContext, parsed.data.userId);
      return { reset: true, state: { status: session.status, flow: session.flow } };
    });

    app.post("/api/simulate/state", async (request, reply) => {
      const parsed = resetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const session = store.getSession(tenantContext, parsed.data.userId);
      return {
        state: { status: session.status, flow: session.flow },
        lastUserMessageAt: session.lastUserMessageAt ?? null
      };
    });

    if (runtime.registry) {
      const resolveAuthorizedTenant = (
        request: FastifyRequest,
        reply: FastifyReply
      ): TenantRuntime | null => {
        const params = tenantParamsSchema.safeParse(request.params);
        if (!params.success) {
          void reply.code(404).send({ error: "tenant_not_found" });
          return null;
        }
        const tenantRuntime = runtime.registry!.byTenantId(params.data.tenantId);
        if (!tenantRuntime) {
          void reply.code(404).send({ error: "tenant_not_found" });
          return null;
        }
        const expected = tenantTokens[tenantRuntime.registration.simulator.keyId];
        const provided = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        if (!expected || !secretsMatch(provided, expected)) {
          void reply.code(401).send({ error: "invalid_tenant_token" });
          return null;
        }
        return tenantRuntime;
      };

      app.post("/api/tenants/:tenantId/simulate", async (request, reply) => {
        const authorized = resolveAuthorizedTenant(request, reply);
        if (!authorized) return;
        const tenantRuntime = authorized;
        const parsed = simulateSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const result = await tenantRuntime.agent.process({
          id: parsed.data.messageId ?? `sim-${randomUUID()}`,
          userId: parsed.data.userId,
          text: parsed.data.message,
          timestamp: new Date(),
          source: "simulator",
          messageType: parsed.data.messageType
        });
        return { tenantId: tenantRuntime.context.tenantId, userId: parsed.data.userId, ...result };
      });

      app.post("/api/tenants/:tenantId/reset", async (request, reply) => {
        const authorized = resolveAuthorizedTenant(request, reply);
        if (!authorized) return;
        const tenantRuntime = authorized;
        const parsed = resetSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const session = store.resetSession(tenantRuntime.context, parsed.data.userId);
        return { reset: true, state: { status: session.status, flow: session.flow } };
      });

      app.post("/api/tenants/:tenantId/state", async (request, reply) => {
        const authorized = resolveAuthorizedTenant(request, reply);
        if (!authorized) return;
        const tenantRuntime = authorized;
        const parsed = resetSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const session = store.getSession(tenantRuntime.context, parsed.data.userId);
        return {
          state: { status: session.status, flow: session.flow },
          lastUserMessageAt: session.lastUserMessageAt ?? null
        };
      });
    }
  }

  if (!production && env.ENABLE_DEBUG_ENDPOINTS) {
    app.get("/api/debug/state", async () => ({
      warning: "Endpoint local: contém dados fornecidos durante os testes.",
      ...store.snapshot(tenantContext)
    }));
  }

  if (!env.DEMO_HOSTED) {
    app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const mode = typeof query["hub.mode"] === "string" ? query["hub.mode"] : undefined;
    const token =
      typeof query["hub.verify_token"] === "string" ? query["hub.verify_token"] : undefined;
    const challenge =
      typeof query["hub.challenge"] === "string" ? query["hub.challenge"] : undefined;

    if (
      env.WHATSAPP_VERIFY_TOKEN &&
      mode === "subscribe" &&
      token === env.WHATSAPP_VERIFY_TOKEN &&
      challenge
    ) {
      return reply.code(200).type("text/plain").send(challenge);
    }
    return reply.code(403).send({ error: "webhook_verification_failed" });
  });

    app.post("/webhooks/whatsapp", async (request, reply) => {
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const signatureHeader = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const mustVerify = production || env.REQUIRE_WEBHOOK_SIGNATURE || Boolean(env.META_APP_SECRET);

    if (
      mustVerify &&
      (!env.META_APP_SECRET || !verifyMetaSignature(rawBody, signature, env.META_APP_SECRET))
    ) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const extractedMessages = extractWhatsAppMessages(request.body);
    const messages = extractedMessages.flatMap((message) => {
      if (runtime.registry) {
        const tenantRuntime =
          message.wabaId && message.phoneNumberId
            ? runtime.registry.byWhatsAppBinding(message.wabaId, message.phoneNumberId)
            : undefined;
        if (!tenantRuntime?.registration.whatsapp?.enabled) {
          request.log.warn(
            { inboundMessageId: message.id },
            "Mensagem ignorada por binding de tenant ausente ou desabilitado"
          );
          return [];
        }
        return [{ message, agent: tenantRuntime.agent, context: tenantRuntime.context }];
      }

      const validWaba = !env.WHATSAPP_WABA_ID || message.wabaId === env.WHATSAPP_WABA_ID;
      const validPhone =
        !env.WHATSAPP_PHONE_NUMBER_ID || message.phoneNumberId === env.WHATSAPP_PHONE_NUMBER_ID;
      if (!validWaba || !validPhone) {
        request.log.warn(
          { inboundMessageId: message.id },
          "Mensagem ignorada por WABA ou número de telefone não configurado"
        );
        return [];
      }
      return [{ message, agent, context: tenantContext }];
    });
    const statuses = extractWhatsAppStatuses(request.body);
    for (const status of statuses) {
      const tenantRuntime =
        runtime.registry && status.wabaId && status.phoneNumberId
          ? runtime.registry.byWhatsAppBinding(status.wabaId, status.phoneNumberId)
          : undefined;
      request.log.info(
        {
          providerMessageId: status.messageId,
          deliveryStatus: status.status,
          ...(tenantRuntime ? { tenantId: tenantRuntime.context.tenantId } : {})
        },
        "Atualização de status do WhatsApp"
      );
    }

    const processBatch = async (): Promise<boolean> => {
      let succeeded = true;
      const queued = messages.map(({ message, agent: routedAgent, context }) => ({
        message,
        routedAgent,
        context,
        outcome: routedAgent.process(message).then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error })
        )
      }));

      for (const item of queued) {
        const { message, routedAgent, context } = item;
        const outcome = await item.outcome;
        if (!outcome.ok) {
          succeeded = false;
          request.log.error(
            { err: outcome.error, inboundMessageId: message.id },
            "Falha ao processar mensagem"
          );
          continue;
        }

        try {
          await enqueueOutbound(context, message.userId, async () => {
            const { result } = outcome;
            if (
              !messenger.enabled ||
              !result.reply ||
              store.isOutboundSettled(context, message.id)
            )
              return;

            if (!routedAgent.shouldSendOutbound(message.userId, result)) {
              store.markOutboundSettled(context, message.id);
              return;
            }

            const sent = await messenger.sendText({
              to: message.userId,
              text: result.reply,
              ...(message.phoneNumberId ? { phoneNumberId: message.phoneNumberId } : {})
            });
            store.markOutboundSettled(context, message.id);
            request.log.info(
              {
                inboundMessageId: message.id,
                outboundMessageId: sent.providerMessageId,
                intent: result.intent,
                agentId: result.agentId,
                releaseVersion: result.releaseVersion,
                tenantId: context.tenantId
              },
              "Resposta enviada ao WhatsApp"
            );
          });
        } catch (error) {
          succeeded = false;
          request.log.error({ err: error, inboundMessageId: message.id }, "Falha ao processar mensagem");
        }
      }
      return succeeded;
    };

    if (env.WEBHOOK_PROCESSING_MODE === "async") {
      setImmediate(() => void processBatch());
    } else {
      const succeeded = await processBatch();
      if (!succeeded) {
        return reply.code(503).send({ received: false, retry: true });
      }
    }

    return reply.code(200).send({ received: true });
    });
  }

  return app;
}
