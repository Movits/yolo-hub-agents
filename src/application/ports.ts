import type {
  AgentResult,
  AppointmentRequest,
  ConversationSession,
  LeadRecord,
  LlmContext,
  LlmDecision,
  SupportTicket
} from "../domain/types.js";
import type { TenantContext } from "../domain/tenant.js";

export interface StoreSnapshot {
  sessions: ConversationSession[];
  leads: LeadRecord[];
  appointments: AppointmentRequest[];
  tickets: SupportTicket[];
}

export interface SessionStore {
  readonly driver: string;
  readonly durability: "ephemeral" | "durable";
  getSession(tenant: TenantContext, userId: string): ConversationSession;
  saveSession(tenant: TenantContext, session: ConversationSession): void;
  resetSession(tenant: TenantContext, userId: string): ConversationSession;
  markMessageProcessed(tenant: TenantContext, messageId: string): boolean;
  releaseMessage(tenant: TenantContext, messageId: string): void;
  saveProcessedResult(tenant: TenantContext, messageId: string, result: AgentResult): void;
  commitResult(
    tenant: TenantContext,
    messageId: string,
    session: ConversationSession,
    result: AgentResult
  ): void;
  getProcessedResult(tenant: TenantContext, messageId: string): AgentResult | undefined;
  markOutboundSettled(tenant: TenantContext, messageId: string): void;
  isOutboundSettled(tenant: TenantContext, messageId: string): boolean;
  createLead(
    tenant: TenantContext,
    sourceMessageId: string,
    input: Omit<LeadRecord, "tenantId" | "agentId" | "id" | "createdAt">
  ): LeadRecord;
  createAppointment(
    tenant: TenantContext,
    sourceMessageId: string,
    input: Omit<
      AppointmentRequest,
      "tenantId" | "agentId" | "id" | "createdAt" | "status"
    >
  ): AppointmentRequest;
  createTicket(
    tenant: TenantContext,
    sourceMessageId: string,
    input: Omit<SupportTicket, "tenantId" | "agentId" | "id" | "createdAt" | "status">
  ): SupportTicket;
  snapshot(tenant: TenantContext): StoreSnapshot;
  close?(): void;
}

export interface LlmResponder {
  decide(context: LlmContext): Promise<LlmDecision>;
}

export interface OutboundMessenger {
  readonly enabled: boolean;
  sendText(input: {
    to: string;
    text: string;
    phoneNumberId?: string;
  }): Promise<{ providerMessageId: string | null }>;
}
