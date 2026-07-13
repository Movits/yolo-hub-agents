import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionStore } from "../application/ports.js";
import type {
  AgentResult,
  AppointmentRequest,
  ConversationSession,
  LeadRecord,
  SupportTicket
} from "../domain/types.js";
import type { TenantContext } from "../domain/tenant.js";

const DEFAULT_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 1_000;
const SCHEMA_VERSION = 1;

interface SqliteStoreOptions {
  now?: () => number;
  claimLeaseMs?: number;
  idempotencyTtlMs?: number;
}

interface PayloadRow {
  payload: string;
}

interface ProcessedMessageRow {
  state: "processing" | "completed";
  lease_until_ms: number;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} deve ser um inteiro positivo.`);
  }
}

function belongsToTenant(
  record: { tenantId: string; agentId: string },
  tenant: TenantContext
): boolean {
  return record.tenantId === tenant.tenantId && record.agentId === tenant.agentId;
}

function operationId(prefix: string, tenant: TenantContext, sourceMessageId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([tenant.tenantId, tenant.agentId, sourceMessageId]))
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `${prefix}-${digest}`;
}

function parsePayload<T>(payload: string, description: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch {
    throw new Error(`Registro SQLite invalido em ${description}.`);
  }
}

export class SqliteStore implements SessionStore {
  readonly driver = "sqlite";
  readonly durability = "durable" as const;

  private readonly database: DatabaseSync;
  private readonly nowMs: () => number;
  private readonly claimLeaseMs: number;
  private readonly idempotencyTtlMs: number;
  private closed = false;

  constructor(path: string, options: SqliteStoreOptions = {}) {
    if (!path.trim()) throw new Error("O caminho do SQLite e obrigatorio.");

    this.nowMs = options.now ?? Date.now;
    this.claimLeaseMs = options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS;
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
    assertPositiveInteger(this.claimLeaseMs, "claimLeaseMs");
    assertPositiveInteger(this.idempotencyTtlMs, "idempotencyTtlMs");

    const databasePath = path === ":memory:" ? path : resolve(path);
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

    this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
    try {
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      this.migrate();
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  getSession(tenant: TenantContext, userId: string): ConversationSession {
    const existing = this.database
      .prepare(
        `SELECT payload
           FROM sessions
          WHERE tenant_id = ? AND agent_id = ? AND user_id = ?`
      )
      .get(tenant.tenantId, tenant.agentId, userId) as PayloadRow | undefined;
    if (existing) return structuredClone(parsePayload<ConversationSession>(existing.payload, "sessions"));

    const session = this.newSession(tenant, userId);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO sessions
           (tenant_id, agent_id, user_id, payload, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        tenant.tenantId,
        tenant.agentId,
        userId,
        JSON.stringify(session),
        session.updatedAt
      );

    const stored = this.database
      .prepare(
        `SELECT payload
           FROM sessions
          WHERE tenant_id = ? AND agent_id = ? AND user_id = ?`
      )
      .get(tenant.tenantId, tenant.agentId, userId) as PayloadRow | undefined;
    if (!stored) throw new Error("Falha ao criar sessao no SQLite.");
    return structuredClone(parsePayload<ConversationSession>(stored.payload, "sessions"));
  }

  saveSession(tenant: TenantContext, session: ConversationSession): void {
    if (!belongsToTenant(session, tenant)) {
      throw new Error("Sessao pertence a outro tenant ou agente.");
    }

    const updated = { ...session, updatedAt: this.nowIso() };
    this.database
      .prepare(
        `INSERT INTO sessions (tenant_id, agent_id, user_id, payload, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, agent_id, user_id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`
      )
      .run(
        tenant.tenantId,
        tenant.agentId,
        session.userId,
        JSON.stringify(updated),
        updated.updatedAt
      );
  }

  resetSession(tenant: TenantContext, userId: string): ConversationSession {
    const session = this.newSession(tenant, userId);
    this.database
      .prepare(
        `INSERT INTO sessions (tenant_id, agent_id, user_id, payload, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, agent_id, user_id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`
      )
      .run(
        tenant.tenantId,
        tenant.agentId,
        userId,
        JSON.stringify(session),
        session.updatedAt
      );
    return structuredClone(session);
  }

  markMessageProcessed(tenant: TenantContext, messageId: string): boolean {
    return this.transaction(() => {
      const currentTime = this.nowMs();
      this.database
        .prepare("DELETE FROM processed_messages WHERE expires_at_ms <= ?")
        .run(currentTime);

      const existing = this.database
        .prepare(
          `SELECT state, lease_until_ms
             FROM processed_messages
            WHERE tenant_id = ? AND agent_id = ? AND message_id = ?`
        )
        .get(tenant.tenantId, tenant.agentId, messageId) as ProcessedMessageRow | undefined;

      if (!existing) {
        this.database
          .prepare(
            `INSERT INTO processed_messages
               (tenant_id, agent_id, message_id, state, claimed_at_ms, lease_until_ms,
                expires_at_ms, result_json, outbound_settled)
             VALUES (?, ?, ?, 'processing', ?, ?, ?, NULL, 0)`
          )
          .run(
            tenant.tenantId,
            tenant.agentId,
            messageId,
            currentTime,
            currentTime + this.claimLeaseMs,
            currentTime + this.idempotencyTtlMs
          );
        return true;
      }

      if (existing.state === "processing" && existing.lease_until_ms <= currentTime) {
        this.database
          .prepare(
            `UPDATE processed_messages
                SET claimed_at_ms = ?, lease_until_ms = ?, expires_at_ms = ?
              WHERE tenant_id = ? AND agent_id = ? AND message_id = ?
                AND state = 'processing' AND lease_until_ms <= ?`
          )
          .run(
            currentTime,
            currentTime + this.claimLeaseMs,
            currentTime + this.idempotencyTtlMs,
            tenant.tenantId,
            tenant.agentId,
            messageId,
            currentTime
          );
        return true;
      }

      return false;
    });
  }

  releaseMessage(tenant: TenantContext, messageId: string): void {
    this.database
      .prepare(
        `DELETE FROM processed_messages
          WHERE tenant_id = ? AND agent_id = ? AND message_id = ?
            AND state = 'processing' AND result_json IS NULL`
      )
      .run(tenant.tenantId, tenant.agentId, messageId);
  }

  saveProcessedResult(tenant: TenantContext, messageId: string, result: AgentResult): void {
    const outcome = this.database
      .prepare(
        `UPDATE processed_messages
            SET state = 'completed', result_json = ?
          WHERE tenant_id = ? AND agent_id = ? AND message_id = ?`
      )
      .run(JSON.stringify(result), tenant.tenantId, tenant.agentId, messageId);
    if (Number(outcome.changes) !== 1) {
      throw new Error("Claim da mensagem ausente ao persistir o resultado.");
    }
  }

  commitResult(
    tenant: TenantContext,
    messageId: string,
    session: ConversationSession,
    result: AgentResult
  ): void {
    this.transaction(() => {
      this.saveSession(tenant, session);
      this.saveProcessedResult(tenant, messageId, result);
    });
  }

  getProcessedResult(tenant: TenantContext, messageId: string): AgentResult | undefined {
    const row = this.database
      .prepare(
        `SELECT result_json AS payload
           FROM processed_messages
          WHERE tenant_id = ? AND agent_id = ? AND message_id = ?
            AND result_json IS NOT NULL`
      )
      .get(tenant.tenantId, tenant.agentId, messageId) as PayloadRow | undefined;
    return row ? structuredClone(parsePayload<AgentResult>(row.payload, "processed_messages")) : undefined;
  }

  markOutboundSettled(tenant: TenantContext, messageId: string): void {
    this.database
      .prepare(
        `UPDATE processed_messages
            SET outbound_settled = 1
          WHERE tenant_id = ? AND agent_id = ? AND message_id = ?`
      )
      .run(tenant.tenantId, tenant.agentId, messageId);
  }

  isOutboundSettled(tenant: TenantContext, messageId: string): boolean {
    const row = this.database
      .prepare(
        `SELECT outbound_settled
           FROM processed_messages
          WHERE tenant_id = ? AND agent_id = ? AND message_id = ?`
      )
      .get(tenant.tenantId, tenant.agentId, messageId) as
      | { outbound_settled: number }
      | undefined;
    return row?.outbound_settled === 1;
  }

  createLead(
    tenant: TenantContext,
    sourceMessageId: string,
    input: Omit<LeadRecord, "tenantId" | "agentId" | "id" | "createdAt">
  ): LeadRecord {
    const record: LeadRecord = {
      ...tenant,
      ...input,
      id: operationId("LEAD", tenant, sourceMessageId),
      createdAt: this.nowIso()
    };
    return this.insertRecord("leads", tenant, record);
  }

  createAppointment(
    tenant: TenantContext,
    sourceMessageId: string,
    input: Omit<
      AppointmentRequest,
      "tenantId" | "agentId" | "id" | "createdAt" | "status"
    >
  ): AppointmentRequest {
    const record: AppointmentRequest = {
      ...tenant,
      ...input,
      id: operationId("AGENDA", tenant, sourceMessageId),
      status: "pending_human_confirmation",
      createdAt: this.nowIso()
    };
    return this.insertRecord("appointments", tenant, record);
  }

  createTicket(
    tenant: TenantContext,
    sourceMessageId: string,
    input: Omit<SupportTicket, "tenantId" | "agentId" | "id" | "createdAt" | "status">
  ): SupportTicket {
    const record: SupportTicket = {
      ...tenant,
      ...input,
      id: operationId("ATD", tenant, sourceMessageId),
      status: "queued",
      createdAt: this.nowIso()
    };
    return this.insertRecord("tickets", tenant, record);
  }

  snapshot(tenant: TenantContext): {
    sessions: ConversationSession[];
    leads: LeadRecord[];
    appointments: AppointmentRequest[];
    tickets: SupportTicket[];
  } {
    return {
      sessions: this.readPayloads<ConversationSession>("sessions", tenant),
      leads: this.readPayloads<LeadRecord>("leads", tenant),
      appointments: this.readPayloads<AppointmentRequest>("appointments", tenant),
      tickets: this.readPayloads<SupportTicket>("tickets", tenant)
    };
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private migrate(): void {
    const currentVersion = Number(
      (this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    );
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(
        `Schema SQLite ${currentVersion} e mais novo que a versao suportada ${SCHEMA_VERSION}.`
      );
    }
    if (currentVersion === SCHEMA_VERSION) return;

    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE sessions (
          tenant_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, agent_id, user_id)
        ) STRICT;

        CREATE TABLE processed_messages (
          tenant_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
          claimed_at_ms INTEGER NOT NULL,
          lease_until_ms INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          result_json TEXT,
          outbound_settled INTEGER NOT NULL DEFAULT 0 CHECK (outbound_settled IN (0, 1)),
          PRIMARY KEY (tenant_id, agent_id, message_id)
        ) STRICT;

        CREATE INDEX processed_messages_expiry_idx
          ON processed_messages (expires_at_ms);

        CREATE TABLE leads (
          tenant_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, agent_id, record_id)
        ) STRICT;

        CREATE TABLE appointments (
          tenant_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, agent_id, record_id)
        ) STRICT;

        CREATE TABLE tickets (
          tenant_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, agent_id, record_id)
        ) STRICT;

        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    });
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private newSession(tenant: TenantContext, userId: string): ConversationSession {
    return {
      tenantId: tenant.tenantId,
      agentId: tenant.agentId,
      userId,
      status: "active",
      flow: "none",
      flowData: {},
      fallbackCount: 0,
      history: [],
      updatedAt: this.nowIso()
    };
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  private insertRecord<T extends LeadRecord | AppointmentRequest | SupportTicket>(
    table: "leads" | "appointments" | "tickets",
    tenant: TenantContext,
    record: T
  ): T {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO ${table} (tenant_id, agent_id, record_id, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        tenant.tenantId,
        tenant.agentId,
        record.id,
        JSON.stringify(record),
        record.createdAt
      );
    const stored = this.database
      .prepare(
        `SELECT payload FROM ${table}
          WHERE tenant_id = ? AND agent_id = ? AND record_id = ?`
      )
      .get(tenant.tenantId, tenant.agentId, record.id) as PayloadRow | undefined;
    if (!stored) throw new Error(`Falha ao persistir registro em ${table}.`);
    return structuredClone(parsePayload<T>(stored.payload, table));
  }

  private readPayloads<T>(
    table: "sessions" | "leads" | "appointments" | "tickets",
    tenant: TenantContext
  ): T[] {
    const rows = this.database
      .prepare(
        `SELECT payload
           FROM ${table}
          WHERE tenant_id = ? AND agent_id = ?
          ORDER BY rowid`
      )
      .all(tenant.tenantId, tenant.agentId) as unknown as PayloadRow[];
    return structuredClone(rows.map((row) => parsePayload<T>(row.payload, table)));
  }
}
