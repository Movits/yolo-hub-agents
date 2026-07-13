import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentResult } from "../src/domain/types.js";
import type { TenantContext } from "../src/domain/tenant.js";
import { SqliteStore } from "../src/infrastructure/sqlite-store.js";

const tenantA: TenantContext = { tenantId: "tenant-a", agentId: "agent-a" };
const tenantB: TenantContext = { tenantId: "tenant-b", agentId: "agent-b" };

const processedResult: AgentResult = {
  agentId: "agent-a",
  releaseVersion: "1.0.0",
  reply: "Resposta persistida",
  intent: "faq",
  source: "faq",
  suppressed: false,
  duplicate: false,
  handoff: false,
  state: { status: "opted_out", flow: "none" }
};

describe("SqliteStore", () => {
  const directories: string[] = [];
  const stores: SqliteStore[] = [];

  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), "yolo-sqlite-store-"));
    directories.push(directory);
    return join(directory, "agent.sqlite");
  }

  function open(
    path: string,
    options: ConstructorParameters<typeof SqliteStore>[1] = {}
  ): SqliteStore {
    const store = new SqliteStore(path, options);
    stores.push(store);
    return store;
  }

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reabre o banco preservando opt-out, resultado, outbound e registros", () => {
    const path = databasePath();
    const first = open(path);
    expect(first.durability).toBe("durable");

    const session = first.getSession(tenantA, "user-1");
    session.status = "opted_out";
    session.lastUserMessageAt = "2026-07-12T15:00:00.000Z";
    session.history.push({
      role: "user",
      text: "STOP",
      at: "2026-07-12T15:00:00.000Z"
    });
    first.saveSession(tenantA, session);

    expect(first.markMessageProcessed(tenantA, "message-1")).toBe(true);
    first.saveProcessedResult(tenantA, "message-1", processedResult);
    first.markOutboundSettled(tenantA, "message-1");

    const lead = first.createLead(tenantA, "lead-message", {
      userId: "user-1",
      name: "Ana",
      company: "Empresa",
      need: "Atendimento",
      contactTime: "Manha",
      consentedAt: "2026-07-12T15:00:00.000Z"
    });
    const appointment = first.createAppointment(tenantA, "appointment-message", {
      userId: "user-1",
      service: "Consulta",
      preferredDateTime: "amanha as 10h",
      timezone: "America/Sao_Paulo"
    });
    const ticket = first.createTicket(tenantA, "ticket-message", {
      userId: "user-1",
      category: "support",
      summary: "Cliente precisa de ajuda",
      reason: "procedimento_esgotado"
    });

    first.close();
    const inspector = new DatabaseSync(path);
    expect(
      (inspector.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    ).toBe(1);
    const definitions = inspector
      .prepare(
        `SELECT sql FROM sqlite_schema
          WHERE type = 'table' AND name IN
            ('sessions', 'processed_messages', 'leads', 'appointments', 'tickets')`
      )
      .all() as unknown as Array<{ sql: string }>;
    expect(definitions).toHaveLength(5);
    expect(definitions.every((definition) => definition.sql.includes("STRICT"))).toBe(true);
    inspector.close();

    const reopened = open(path);
    expect(reopened.getSession(tenantA, "user-1")).toMatchObject({
      status: "opted_out",
      lastUserMessageAt: "2026-07-12T15:00:00.000Z",
      history: [{ role: "user", text: "STOP" }]
    });
    expect(reopened.markMessageProcessed(tenantA, "message-1")).toBe(false);
    expect(reopened.getProcessedResult(tenantA, "message-1")).toEqual(processedResult);
    expect(reopened.isOutboundSettled(tenantA, "message-1")).toBe(true);

    const snapshot = reopened.snapshot(tenantA);
    expect(snapshot.leads).toEqual([lead]);
    expect(snapshot.appointments).toEqual([appointment]);
    expect(snapshot.tickets).toEqual([ticket]);
  });

  it("isola sessoes, deduplicacao, resultados e registros por tenant e agente", () => {
    const store = open(databasePath());
    const sessionA = store.getSession(tenantA, "shared-user");
    sessionA.status = "opted_out";
    store.saveSession(tenantA, sessionA);

    expect(store.getSession(tenantB, "shared-user").status).toBe("active");
    expect(store.markMessageProcessed(tenantA, "shared-message")).toBe(true);
    expect(store.markMessageProcessed(tenantB, "shared-message")).toBe(true);
    store.saveProcessedResult(tenantA, "shared-message", processedResult);

    store.createLead(tenantA, "tenant-a-lead", {
      userId: "shared-user",
      name: "Ana",
      company: "Empresa A",
      need: "Venda",
      contactTime: "Tarde",
      consentedAt: "2026-07-12T15:00:00.000Z"
    });
    store.createAppointment(tenantB, "tenant-b-appointment", {
      userId: "shared-user",
      service: "Servico B",
      preferredDateTime: "sexta-feira",
      timezone: "America/Sao_Paulo"
    });

    expect(store.getProcessedResult(tenantA, "shared-message")).toEqual(processedResult);
    expect(store.getProcessedResult(tenantB, "shared-message")).toBeUndefined();
    expect(store.snapshot(tenantA)).toMatchObject({
      sessions: [{ status: "opted_out" }],
      leads: [{ company: "Empresa A" }],
      appointments: []
    });
    expect(store.snapshot(tenantB)).toMatchObject({
      sessions: [{ status: "active" }],
      leads: [],
      appointments: [{ service: "Servico B" }]
    });
  });

  it("retoma um claim processing somente depois do lease expirar", () => {
    let currentTime = 1_000;
    const store = open(databasePath(), {
      now: () => currentTime,
      claimLeaseMs: 500,
      idempotencyTtlMs: 10_000
    });

    expect(store.markMessageProcessed(tenantA, "stale-message")).toBe(true);
    expect(store.markMessageProcessed(tenantA, "stale-message")).toBe(false);
    currentTime = 1_499;
    expect(store.markMessageProcessed(tenantA, "stale-message")).toBe(false);
    currentTime = 1_500;
    expect(store.markMessageProcessed(tenantA, "stale-message")).toBe(true);

    store.saveProcessedResult(tenantA, "stale-message", processedResult);
    currentTime = 2_500;
    expect(store.markMessageProcessed(tenantA, "stale-message")).toBe(false);
  });

  it("libera claim sem resultado e preserva claim concluido", () => {
    const store = open(databasePath());

    expect(store.markMessageProcessed(tenantA, "retryable")).toBe(true);
    store.releaseMessage(tenantA, "retryable");
    expect(store.markMessageProcessed(tenantA, "retryable")).toBe(true);

    store.saveProcessedResult(tenantA, "retryable", processedResult);
    store.releaseMessage(tenantA, "retryable");
    expect(store.markMessageProcessed(tenantA, "retryable")).toBe(false);
  });

  it("remove a deduplicacao quando o TTL expira", () => {
    let currentTime = 10_000;
    const store = open(databasePath(), {
      now: () => currentTime,
      claimLeaseMs: 100,
      idempotencyTtlMs: 1_000
    });

    expect(store.markMessageProcessed(tenantA, "expiring-message")).toBe(true);
    store.saveProcessedResult(tenantA, "expiring-message", processedResult);
    currentTime = 10_999;
    expect(store.markMessageProcessed(tenantA, "expiring-message")).toBe(false);
    currentTime = 11_000;
    expect(store.markMessageProcessed(tenantA, "expiring-message")).toBe(true);
    expect(store.getProcessedResult(tenantA, "expiring-message")).toBeUndefined();
    expect(store.isOutboundSettled(tenantA, "expiring-message")).toBe(false);
  });

  it("confirma sessão e resultado atomicamente e não duplica registros na retomada", () => {
    const store = open(databasePath());
    expect(store.markMessageProcessed(tenantA, "atomic-message")).toBe(true);
    const invalidSession = {
      ...store.getSession(tenantA, "atomic-user"),
      tenantId: "outro-tenant" as const,
      status: "opted_out" as const
    };

    expect(() =>
      store.commitResult(tenantA, "atomic-message", invalidSession, processedResult)
    ).toThrow("outro tenant");
    expect(store.getSession(tenantA, "atomic-user").status).toBe("active");
    expect(store.getProcessedResult(tenantA, "atomic-message")).toBeUndefined();

    const first = store.createLead(tenantA, "same-source-message", {
      userId: "atomic-user",
      name: "Ana",
      company: "Empresa original",
      need: "Venda",
      contactTime: "Tarde",
      consentedAt: "2026-07-12T15:00:00.000Z"
    });
    const retried = store.createLead(tenantA, "same-source-message", {
      userId: "atomic-user",
      name: "Outro nome",
      company: "Não deve sobrescrever",
      need: "Outro",
      contactTime: "Noite",
      consentedAt: "2026-07-12T16:00:00.000Z"
    });
    expect(retried).toEqual(first);
    expect(store.snapshot(tenantA).leads).toHaveLength(1);
  });
});
