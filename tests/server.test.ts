import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { OutboundMessenger } from "../src/application/ports.js";
import { loadEnv } from "../src/config/env.js";
import { buildServer } from "../src/http/server.js";

class MockMessenger implements OutboundMessenger {
  readonly enabled = true;
  readonly sent: Array<{ to: string; text: string; phoneNumberId?: string }> = [];
  attempts = 0;

  constructor(private failuresRemaining = 0) {}

  async sendText(input: {
    to: string;
    text: string;
    phoneNumberId?: string;
  }): Promise<{ providerMessageId: string }> {
    this.attempts += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("falha simulada da Meta");
    }
    this.sent.push(input);
    return { providerMessageId: `out-${this.sent.length}` };
  }
}

class BlockingMessenger implements OutboundMessenger {
  readonly enabled = true;
  readonly sent: Array<{ to: string; text: string; phoneNumberId?: string }> = [];
  attempts = 0;
  private releaseSend: (() => void) | undefined;
  private markStarted: (() => void) | undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseSend = resolve;
  });

  release(): void {
    this.releaseSend?.();
  }

  async sendText(input: {
    to: string;
    text: string;
    phoneNumberId?: string;
  }): Promise<{ providerMessageId: string }> {
    this.attempts += 1;
    this.markStarted?.();
    await this.gate;
    this.sent.push(input);
    return { providerMessageId: `out-${this.sent.length}` };
  }
}

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
    ENABLE_SIMULATOR: "true",
    ENABLE_DEBUG_ENDPOINTS: "true",
    WEBHOOK_PROCESSING_MODE: "sync",
    OPENAI_API_KEY: "",
    WHATSAPP_VERIFY_TOKEN: "verify-me",
    META_APP_SECRET: "app-secret",
    REQUIRE_WEBHOOK_SIGNATURE: "true",
    WHATSAPP_SEND_ENABLED: "false"
  });
}

function webhookPayload(messageId = "wamid-in-1", body = "Oi") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "phone-1" },
              contacts: [{ wa_id: "5511999", profile: { name: "Ana" } }],
              messages: [
                {
                  from: "5511999",
                  id: messageId,
                  timestamp: "1783868400",
                  type: "text",
                  text: { body }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

function signature(raw: string): string {
  return `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
}

describe("HTTP server", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("expõe health e simulador sem credenciais externas", async () => {
    app = buildServer({ env: testEnv(), llm: null });

    const ui = await app.inject({ method: "GET", url: "/" });
    const uiScript = await app.inject({ method: "GET", url: "/app.js" });
    const health = await app.inject({ method: "GET", url: "/health" });
    const sessionState = await app.inject({
      method: "POST",
      url: "/api/simulate/state",
      payload: { userId: "test" }
    });
    const simulated = await app.inject({
      method: "POST",
      url: "/api/simulate",
      payload: { userId: "test", message: "Qual o horário de atendimento?" }
    });

    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(ui.body).toContain("Bancada do agente");
    expect(uiScript.statusCode).toBe(200);
    expect(uiScript.body).toContain("/api/simulate");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", openai: "deterministic" });
    expect(sessionState.statusCode).toBe(200);
    expect(sessionState.json().state).toEqual({ status: "active", flow: "none" });
    expect(simulated.statusCode).toBe(200);
    expect(simulated.json().reply).toContain("segunda a sexta");
  });

  it("não registra simulador/debug em produção e exige App Secret", async () => {
    const insecureProduction = loadEnv({
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
      META_APP_SECRET: "",
      WHATSAPP_SEND_ENABLED: "false"
    });
    expect(() => buildServer({ env: insecureProduction, llm: null })).toThrow("META_APP_SECRET");

    const production = loadEnv({
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
      META_APP_SECRET: "production-secret",
      WHATSAPP_WABA_ID: "waba-production",
      WHATSAPP_PHONE_NUMBER_ID: "phone-production",
      WHATSAPP_SEND_ENABLED: "false"
    });
    app = buildServer({ env: production, llm: null });

    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "POST", url: "/api/simulate", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/debug/state" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);

    const unsafeAsync = loadEnv({
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
      META_APP_SECRET: "production-secret",
      WHATSAPP_WABA_ID: "waba-production",
      WHATSAPP_PHONE_NUMBER_ID: "phone-production",
      WEBHOOK_PROCESSING_MODE: "async",
      WHATSAPP_SEND_ENABLED: "false"
    });
    expect(() => buildServer({ env: unsafeAsync, llm: null })).toThrow("fila durável");
  });

  it("recusa simulador exposto fora do loopback", () => {
    const exposed = { ...testEnv(), HOST: "0.0.0.0" };
    expect(() => buildServer({ env: exposed, llm: null })).toThrow("loopback");
  });

  it("valida o challenge do webhook", async () => {
    app = buildServer({ env: testEnv(), llm: null });

    const valid = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"
    });

    expect(valid.statusCode).toBe(200);
    expect(valid.body).toBe("12345");
    expect(invalid.statusCode).toBe(403);
  });

  it("rejeita assinatura inválida", async () => {
    app = buildServer({ env: testEnv(), llm: null });
    const raw = JSON.stringify(webhookPayload());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
      payload: raw
    });

    expect(response.statusCode).toBe(401);
  });

  it("ignora mensagens de WABA diferente da configuração", async () => {
    const messenger = new MockMessenger();
    const env = {
      ...testEnv(),
      WHATSAPP_WABA_ID: "waba-esperada",
      WHATSAPP_PHONE_NUMBER_ID: "phone-1"
    };
    app = buildServer({ env, llm: null, messenger });
    const raw = JSON.stringify(webhookPayload("wamid-wrong-waba"));

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature(raw)
      },
      payload: raw
    });

    expect(response.statusCode).toBe(200);
    expect(messenger.sent).toHaveLength(0);
  });

  it("processa mensagem assinada, responde e deduplica retries", async () => {
    const messenger = new MockMessenger();
    app = buildServer({ env: testEnv(), llm: null, messenger });
    const raw = JSON.stringify(webhookPayload());
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": signature(raw)
    };

    const first = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers,
      payload: raw
    });
    const retry = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers,
      payload: raw
    });

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]).toMatchObject({ to: "5511999", phoneNumberId: "phone-1" });
    expect(messenger.sent[0]?.text).toContain("assistente virtual");
  });

  it("retorna 503 em falha de envio e reaproveita a resposta no retry", async () => {
    const messenger = new MockMessenger(1);
    app = buildServer({ env: testEnv(), llm: null, messenger });
    const raw = JSON.stringify(webhookPayload("wamid-retry"));
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": signature(raw)
    };

    const failed = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers,
      payload: raw
    });
    const retried = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers,
      payload: raw
    });

    expect(failed.statusCode).toBe(503);
    expect(retried.statusCode).toBe(200);
    expect(messenger.attempts).toBe(2);
    expect(messenger.sent).toHaveLength(1);
  });

  it("impede dois envios do mesmo wamid quando webhooks concorrem", async () => {
    const messenger = new BlockingMessenger();
    app = buildServer({ env: testEnv(), llm: null, messenger });
    const raw = JSON.stringify(webhookPayload("wamid-concurrent"));
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": signature(raw)
    };

    const first = app.inject({ method: "POST", url: "/webhooks/whatsapp", headers, payload: raw });
    await messenger.started;
    const second = app.inject({ method: "POST", url: "/webhooks/whatsapp", headers, payload: raw });
    await new Promise<void>((resolve) => setImmediate(resolve));
    messenger.release();
    const responses = await Promise.all([first, second]);

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(messenger.attempts).toBe(1);
    expect(messenger.sent).toHaveLength(1);
  });

  it("pré-registra STOP em lote e suprime respostas anteriores do mesmo contato", async () => {
    const messenger = new MockMessenger();
    app = buildServer({ env: testEnv(), llm: null, messenger });
    const payload = webhookPayload("wamid-before-stop", "Oi");
    payload.entry[0]?.changes[0]?.value.messages.push({
      from: "5511999",
      id: "wamid-stop",
      timestamp: "1783868401",
      type: "text",
      text: { body: "STOP" }
    });
    const raw = JSON.stringify(payload);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature(raw)
      },
      payload: raw
    });

    expect(response.statusCode).toBe(200);
    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]?.text).toContain("não receberá novas mensagens");
  });
});
