import { randomUUID } from "node:crypto";
import type { SessionStore } from "../application/ports.js";
import type {
  AgentResult,
  AppointmentRequest,
  ConversationSession,
  LeadRecord,
  SupportTicket
} from "../domain/types.js";
import { tenantScopeKey, type TenantContext } from "../domain/tenant.js";

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function belongsToTenant(
  record: { tenantId: string; agentId: string },
  tenant: TenantContext
): boolean {
  return record.tenantId === tenant.tenantId && record.agentId === tenant.agentId;
}

function newSession(tenant: TenantContext, userId: string): ConversationSession {
  return {
    tenantId: tenant.tenantId,
    agentId: tenant.agentId,
    userId,
    status: "active",
    flow: "none",
    flowData: {},
    fallbackCount: 0,
    history: [],
    updatedAt: now()
  };
}

export class MemoryStore implements SessionStore {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly processedMessages = new Map<
    string,
    { timestamp: number; result: AgentResult | undefined; outboundSettled: boolean }
  >();
  private readonly leads: LeadRecord[] = [];
  private readonly appointments: AppointmentRequest[] = [];
  private readonly tickets: SupportTicket[] = [];

  getSession(tenant: TenantContext, userId: string): ConversationSession {
    const key = tenantScopeKey(tenant, userId);
    const existing = this.sessions.get(key);
    if (existing) return structuredClone(existing);

    const session = newSession(tenant, userId);
    this.sessions.set(key, session);
    return structuredClone(session);
  }

  saveSession(tenant: TenantContext, session: ConversationSession): void {
    if (!belongsToTenant(session, tenant)) {
      throw new Error("Sessao pertence a outro tenant ou agente.");
    }
    this.sessions.set(
      tenantScopeKey(tenant, session.userId),
      structuredClone({ ...session, updatedAt: now() })
    );
  }

  resetSession(tenant: TenantContext, userId: string): ConversationSession {
    const session = newSession(tenant, userId);
    this.sessions.set(tenantScopeKey(tenant, userId), session);
    return structuredClone(session);
  }

  markMessageProcessed(tenant: TenantContext, messageId: string): boolean {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [id, entry] of this.processedMessages) {
      if (entry.timestamp < cutoff) this.processedMessages.delete(id);
    }

    const key = tenantScopeKey(tenant, messageId);
    if (this.processedMessages.has(key)) return false;
    this.processedMessages.set(key, {
      timestamp: Date.now(),
      result: undefined,
      outboundSettled: false
    });
    return true;
  }

  releaseMessage(tenant: TenantContext, messageId: string): void {
    const key = tenantScopeKey(tenant, messageId);
    const entry = this.processedMessages.get(key);
    if (entry && !entry.result) this.processedMessages.delete(key);
  }

  saveProcessedResult(tenant: TenantContext, messageId: string, result: AgentResult): void {
    const entry = this.processedMessages.get(tenantScopeKey(tenant, messageId));
    if (!entry) return;
    entry.result = structuredClone(result);
  }

  getProcessedResult(tenant: TenantContext, messageId: string): AgentResult | undefined {
    const result = this.processedMessages.get(tenantScopeKey(tenant, messageId))?.result;
    return result ? structuredClone(result) : undefined;
  }

  markOutboundSettled(tenant: TenantContext, messageId: string): void {
    const entry = this.processedMessages.get(tenantScopeKey(tenant, messageId));
    if (entry) entry.outboundSettled = true;
  }

  isOutboundSettled(tenant: TenantContext, messageId: string): boolean {
    return this.processedMessages.get(tenantScopeKey(tenant, messageId))?.outboundSettled ?? false;
  }

  createLead(
    tenant: TenantContext,
    input: Omit<LeadRecord, "tenantId" | "agentId" | "id" | "createdAt">
  ): LeadRecord {
    const record: LeadRecord = {
      ...tenant,
      ...input,
      id: shortId("LEAD"),
      createdAt: now()
    };
    this.leads.push(record);
    return structuredClone(record);
  }

  createAppointment(
    tenant: TenantContext,
    input: Omit<
      AppointmentRequest,
      "tenantId" | "agentId" | "id" | "createdAt" | "status"
    >
  ): AppointmentRequest {
    const record: AppointmentRequest = {
      ...tenant,
      ...input,
      id: shortId("AGENDA"),
      status: "pending_human_confirmation",
      createdAt: now()
    };
    this.appointments.push(record);
    return structuredClone(record);
  }

  createTicket(
    tenant: TenantContext,
    input: Omit<SupportTicket, "tenantId" | "agentId" | "id" | "createdAt" | "status">
  ): SupportTicket {
    const record: SupportTicket = {
      ...tenant,
      ...input,
      id: shortId("ATD"),
      status: "queued",
      createdAt: now()
    };
    this.tickets.push(record);
    return structuredClone(record);
  }

  snapshot(tenant: TenantContext): {
    sessions: ConversationSession[];
    leads: LeadRecord[];
    appointments: AppointmentRequest[];
    tickets: SupportTicket[];
  } {
    return structuredClone({
      sessions: [...this.sessions.values()].filter((session) => belongsToTenant(session, tenant)),
      leads: this.leads.filter((lead) => belongsToTenant(lead, tenant)),
      appointments: this.appointments.filter((appointment) => belongsToTenant(appointment, tenant)),
      tickets: this.tickets.filter((ticket) => belongsToTenant(ticket, tenant))
    });
  }
}
