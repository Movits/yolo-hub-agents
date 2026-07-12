import type {
  AgentResult,
  AppointmentRequest,
  ConversationSession,
  LeadRecord,
  LlmContext,
  LlmDecision,
  SupportTicket
} from "../domain/types.js";

export interface SessionStore {
  getSession(userId: string): ConversationSession;
  saveSession(session: ConversationSession): void;
  resetSession(userId: string): ConversationSession;
  markMessageProcessed(messageId: string): boolean;
  releaseMessage(messageId: string): void;
  saveProcessedResult(messageId: string, result: AgentResult): void;
  getProcessedResult(messageId: string): AgentResult | undefined;
  markOutboundSettled(messageId: string): void;
  isOutboundSettled(messageId: string): boolean;
  createLead(input: Omit<LeadRecord, "id" | "createdAt">): LeadRecord;
  createAppointment(
    input: Omit<AppointmentRequest, "id" | "createdAt" | "status">
  ): AppointmentRequest;
  createTicket(input: Omit<SupportTicket, "id" | "createdAt" | "status">): SupportTicket;
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
