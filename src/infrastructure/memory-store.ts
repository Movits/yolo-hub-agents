import { randomUUID } from "node:crypto";
import type { SessionStore } from "../application/ports.js";
import type {
  AgentResult,
  AppointmentRequest,
  ConversationSession,
  LeadRecord,
  SupportTicket
} from "../domain/types.js";

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function newSession(userId: string): ConversationSession {
  return {
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

  getSession(userId: string): ConversationSession {
    const existing = this.sessions.get(userId);
    if (existing) return structuredClone(existing);

    const session = newSession(userId);
    this.sessions.set(userId, session);
    return structuredClone(session);
  }

  saveSession(session: ConversationSession): void {
    this.sessions.set(session.userId, structuredClone({ ...session, updatedAt: now() }));
  }

  resetSession(userId: string): ConversationSession {
    const session = newSession(userId);
    this.sessions.set(userId, session);
    return structuredClone(session);
  }

  markMessageProcessed(messageId: string): boolean {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [id, entry] of this.processedMessages) {
      if (entry.timestamp < cutoff) this.processedMessages.delete(id);
    }

    if (this.processedMessages.has(messageId)) return false;
    this.processedMessages.set(messageId, {
      timestamp: Date.now(),
      result: undefined,
      outboundSettled: false
    });
    return true;
  }

  releaseMessage(messageId: string): void {
    const entry = this.processedMessages.get(messageId);
    if (entry && !entry.result) this.processedMessages.delete(messageId);
  }

  saveProcessedResult(messageId: string, result: AgentResult): void {
    const entry = this.processedMessages.get(messageId);
    if (!entry) return;
    entry.result = structuredClone(result);
  }

  getProcessedResult(messageId: string): AgentResult | undefined {
    const result = this.processedMessages.get(messageId)?.result;
    return result ? structuredClone(result) : undefined;
  }

  markOutboundSettled(messageId: string): void {
    const entry = this.processedMessages.get(messageId);
    if (entry) entry.outboundSettled = true;
  }

  isOutboundSettled(messageId: string): boolean {
    return this.processedMessages.get(messageId)?.outboundSettled ?? false;
  }

  createLead(input: Omit<LeadRecord, "id" | "createdAt">): LeadRecord {
    const record: LeadRecord = { ...input, id: shortId("LEAD"), createdAt: now() };
    this.leads.push(record);
    return structuredClone(record);
  }

  createAppointment(
    input: Omit<AppointmentRequest, "id" | "createdAt" | "status">
  ): AppointmentRequest {
    const record: AppointmentRequest = {
      ...input,
      id: shortId("AGENDA"),
      status: "pending_human_confirmation",
      createdAt: now()
    };
    this.appointments.push(record);
    return structuredClone(record);
  }

  createTicket(input: Omit<SupportTicket, "id" | "createdAt" | "status">): SupportTicket {
    const record: SupportTicket = {
      ...input,
      id: shortId("ATD"),
      status: "queued",
      createdAt: now()
    };
    this.tickets.push(record);
    return structuredClone(record);
  }

  snapshot(): {
    sessions: ConversationSession[];
    leads: LeadRecord[];
    appointments: AppointmentRequest[];
    tickets: SupportTicket[];
  } {
    return structuredClone({
      sessions: [...this.sessions.values()],
      leads: this.leads,
      appointments: this.appointments,
      tickets: this.tickets
    });
  }
}
