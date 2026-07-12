import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { RuntimeOptions } from "../runtime.js";
import { createRuntime } from "../runtime.js";
import { extractWhatsAppMessages, extractWhatsAppStatuses } from "../adapters/whatsapp/payload.js";
import { verifyMetaSignature } from "../adapters/whatsapp/signature.js";

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

export function buildServer(options: RuntimeOptions = {}): FastifyInstance {
  const runtime = createRuntime(options);
  const { env, knowledge, store, agent, messenger } = runtime;
  const production = env.NODE_ENV === "production";
  const loopbackHost = ["127.0.0.1", "localhost", "::1"].includes(env.HOST);
  if (!production && (env.ENABLE_SIMULATOR || env.ENABLE_DEBUG_ENDPOINTS) && !loopbackHost) {
    throw new Error("Simulador e debug só podem ser habilitados em um HOST de loopback neste MVP.");
  }
  if ((production || env.WHATSAPP_SEND_ENABLED || env.REQUIRE_WEBHOOK_SIGNATURE) && !env.META_APP_SECRET) {
    throw new Error("Produção, envio habilitado ou REQUIRE_WEBHOOK_SIGNATURE=true exige META_APP_SECRET.");
  }
  if (
    (production || env.WHATSAPP_SEND_ENABLED) &&
    (!env.WHATSAPP_WABA_ID || !env.WHATSAPP_PHONE_NUMBER_ID)
  ) {
    throw new Error("Produção ou envio habilitado exige WHATSAPP_WABA_ID e WHATSAPP_PHONE_NUMBER_ID.");
  }
  if (production && env.WEBHOOK_PROCESSING_MODE === "async") {
    throw new Error("WEBHOOK_PROCESSING_MODE=async exige uma fila durável e não é permitido neste MVP em produção.");
  }

  const app = Fastify({
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
  const outboundQueues = new Map<string, Promise<void>>();

  const enqueueOutbound = (userId: string, task: () => Promise<void>): Promise<void> => {
    const previous = outboundQueues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    outboundQueues.set(userId, current);
    return current.finally(() => {
      if (outboundQueues.get(userId) === current) outboundQueues.delete(userId);
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

  if (!production && env.ENABLE_SIMULATOR) {
    const publicDirectory = resolve("public");
    const uiHtml = readFileSync(resolve(publicDirectory, "index.html"), "utf8");
    const uiCss = readFileSync(resolve(publicDirectory, "app.css"), "utf8");
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
    app.get("/app.js", async (_request, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .type("text/javascript; charset=utf-8")
        .send(uiJavaScript)
    );
    app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());
  }

  app.get("/health", async () =>
    production
      ? { status: "ok" }
      : {
          status: "ok",
          service: "whatsapp-business-agent",
          mode: knowledge.prototype ? "prototype" : "configured",
          company: knowledge.company.name,
          openai: runtime.llm ? "configured" : "deterministic",
          whatsappSending: messenger.enabled,
          storage: "memory"
        }
  );

  if (!production && env.ENABLE_SIMULATOR) {
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
      const session = store.resetSession(parsed.data.userId);
      return { reset: true, state: { status: session.status, flow: session.flow } };
    });

    app.post("/api/simulate/state", async (request, reply) => {
      const parsed = resetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const session = store.getSession(parsed.data.userId);
      return {
        state: { status: session.status, flow: session.flow },
        lastUserMessageAt: session.lastUserMessageAt ?? null
      };
    });
  }

  if (!production && env.ENABLE_DEBUG_ENDPOINTS) {
    app.get("/api/debug/state", async () => ({
      warning: "Endpoint local: contém dados fornecidos durante os testes.",
      ...store.snapshot()
    }));
  }

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
    const messages = extractedMessages.filter((message) => {
      const validWaba = !env.WHATSAPP_WABA_ID || message.wabaId === env.WHATSAPP_WABA_ID;
      const validPhone =
        !env.WHATSAPP_PHONE_NUMBER_ID || message.phoneNumberId === env.WHATSAPP_PHONE_NUMBER_ID;
      if (!validWaba || !validPhone) {
        request.log.warn(
          { inboundMessageId: message.id },
          "Mensagem ignorada por WABA ou número de telefone não configurado"
        );
      }
      return validWaba && validPhone;
    });
    const statuses = extractWhatsAppStatuses(request.body);
    for (const status of statuses) {
      request.log.info(
        { providerMessageId: status.messageId, deliveryStatus: status.status },
        "Atualização de status do WhatsApp"
      );
    }

    const processBatch = async (): Promise<boolean> => {
      let succeeded = true;
      const queued = messages.map((message) => ({
        message,
        outcome: agent.process(message).then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error })
        )
      }));

      for (const item of queued) {
        const { message } = item;
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
          await enqueueOutbound(message.userId, async () => {
            const { result } = outcome;
            if (!messenger.enabled || !result.reply || store.isOutboundSettled(message.id)) return;

            if (!agent.shouldSendOutbound(message.userId, result)) {
              store.markOutboundSettled(message.id);
              return;
            }

            const sent = await messenger.sendText({
              to: message.userId,
              text: result.reply,
              ...(message.phoneNumberId ? { phoneNumberId: message.phoneNumberId } : {})
            });
            store.markOutboundSettled(message.id);
            request.log.info(
              {
                inboundMessageId: message.id,
                outboundMessageId: sent.providerMessageId,
                intent: result.intent
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

  return app;
}
