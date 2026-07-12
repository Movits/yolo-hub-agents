export const intents = [
  "greeting",
  "business_info",
  "faq",
  "pricing",
  "sales",
  "scheduling",
  "support",
  "complaint",
  "human",
  "opt_out",
  "opt_in",
  "unknown"
] as const;

export type Intent = (typeof intents)[number];

export type MessageSource = "simulator" | "whatsapp";
export type ReplySource = "rule" | "faq" | "openai" | "system";
export type SessionStatus = "active" | "human_handoff" | "opted_out";

export type FlowStep =
  | "none"
  | "lead_consent"
  | "lead_name"
  | "lead_company"
  | "lead_need"
  | "lead_contact_time"
  | "lead_confirm"
  | "schedule_service"
  | "schedule_datetime"
  | "schedule_timezone"
  | "schedule_confirm"
  | "support_description"
  | "support_check_1"
  | "support_check_2"
  | "opt_in_confirm";

export interface IncomingMessage {
  id: string;
  userId: string;
  text: string;
  timestamp: Date;
  source: MessageSource;
  messageType: string;
  profileName?: string;
  phoneNumberId?: string;
  wabaId?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface ConversationSession {
  userId: string;
  status: SessionStatus;
  flow: FlowStep;
  flowData: Record<string, string>;
  fallbackCount: number;
  history: ConversationMessage[];
  lastUserMessageAt?: string;
  updatedAt: string;
}

export interface AgentResult {
  reply: string | null;
  intent: Intent;
  source: ReplySource;
  suppressed: boolean;
  duplicate: boolean;
  handoff: boolean;
  protocol?: string;
  state: {
    status: SessionStatus;
    flow: FlowStep;
  };
}

export interface AssistantConfig {
  name: string;
  tone: string;
  humanResponseSla: string;
}

export interface CompanyInfo {
  name: string;
  industry: string;
  description: string;
  businessHours: string;
  timezone: string;
  address: string;
  email: string;
  humanPhone: string;
  remoteService: string;
  invoice: string;
}

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  price: string;
}

export interface FaqEntry {
  id: string;
  questions: string[];
  answer: string;
}

export interface SupportProcedure {
  id: string;
  triggers: string[];
  steps: string[];
}

export interface BusinessKnowledge {
  agentId: string;
  prototype: boolean;
  notice: string;
  assistant: AssistantConfig;
  company: CompanyInfo;
  services: ServiceInfo[];
  policies: {
    paymentMethods: string;
    cancellation: string;
    supportResponseTime: string;
    privacyContact: string;
  };
  faqs: FaqEntry[];
  supportProcedures: SupportProcedure[];
}

export interface LlmContext {
  message: string;
  history: ConversationMessage[];
  knowledge: BusinessKnowledge;
}

export interface LlmDecision {
  intent: Intent;
  reply: string;
  confidence: number;
  needsHuman: boolean;
  reason: string;
}

export interface LeadRecord {
  id: string;
  userId: string;
  name: string;
  company: string;
  need: string;
  contactTime: string;
  consentedAt: string;
  createdAt: string;
}

export interface AppointmentRequest {
  id: string;
  userId: string;
  service: string;
  preferredDateTime: string;
  timezone: string;
  status: "pending_human_confirmation";
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  category: "support" | "sales" | "complaint" | "general";
  summary: string;
  reason: string;
  status: "queued";
  createdAt: string;
}
