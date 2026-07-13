import type { OutboundMessenger } from "../../application/ports.js";

export interface MetaWhatsAppClientOptions {
  enabled: boolean;
  graphVersion: string;
  accessToken?: string;
  defaultPhoneNumberId?: string;
  timeoutMs?: number;
}

export class MetaWhatsAppClient implements OutboundMessenger {
  readonly enabled: boolean;
  private readonly graphVersion: string;
  private readonly accessToken: string | undefined;
  private readonly defaultPhoneNumberId: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: MetaWhatsAppClientOptions) {
    this.enabled = options.enabled;
    this.graphVersion = options.graphVersion;
    this.accessToken = options.accessToken;
    this.defaultPhoneNumberId = options.defaultPhoneNumberId;
    this.timeoutMs = options.timeoutMs ?? 10_000;

    if (this.enabled && !this.accessToken) {
      throw new Error("WHATSAPP_SEND_ENABLED=true exige WHATSAPP_ACCESS_TOKEN.");
    }
  }

  async sendText(input: {
    to: string;
    text: string;
    phoneNumberId?: string;
  }): Promise<{ providerMessageId: string | null }> {
    if (!this.enabled) return { providerMessageId: null };

    const phoneNumberId = input.phoneNumberId ?? this.defaultPhoneNumberId;
    if (!phoneNumberId || !this.accessToken) {
      throw new Error("Credenciais do WhatsApp não configuradas.");
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "text",
          text: { preview_url: false, body: input.text }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      }
    );

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`A Meta recusou o envio (HTTP ${response.status}).`);
    }

    const providerMessageId = extractProviderMessageId(body);
    if (!providerMessageId) {
      throw new Error("A Meta respondeu sem um ID de mensagem; o estado do envio é desconhecido.");
    }
    return { providerMessageId };
  }
}

function extractProviderMessageId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("messages" in body)) return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  const first = messages[0];
  if (typeof first !== "object" || first === null || !("id" in first)) return null;
  return typeof (first as { id?: unknown }).id === "string" ? (first as { id: string }).id : null;
}
