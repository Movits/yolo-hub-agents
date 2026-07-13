import type { IncomingMessage } from "../../domain/types.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function messageText(message: JsonObject, type: string): string {
  if (type === "text" && isObject(message.text)) {
    return asString(message.text.body) ?? "";
  }

  if (type === "interactive" && isObject(message.interactive)) {
    const interactive = message.interactive;
    if (isObject(interactive.button_reply)) {
      return asString(interactive.button_reply.title) ?? asString(interactive.button_reply.id) ?? "";
    }
    if (isObject(interactive.list_reply)) {
      return asString(interactive.list_reply.title) ?? asString(interactive.list_reply.id) ?? "";
    }
  }

  if ((type === "image" || type === "video" || type === "document") && isObject(message[type])) {
    return asString((message[type] as JsonObject).caption) ?? "";
  }

  return "";
}

function parseTimestamp(value: unknown): Date {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1_000);
  return new Date();
}

export function extractWhatsAppMessages(payload: unknown): IncomingMessage[] {
  if (!isObject(payload) || payload.object !== "whatsapp_business_account") return [];

  const results: IncomingMessage[] = [];
  for (const entry of asObjects(payload.entry)) {
    const wabaId = asString(entry.id);
    for (const change of asObjects(entry.changes)) {
      if (change.field !== "messages" || !isObject(change.value)) continue;
      const value = change.value;
      const phoneNumberId = isObject(value.metadata)
        ? asString(value.metadata.phone_number_id)
        : undefined;
      const names = new Map<string, string>();

      for (const contact of asObjects(value.contacts)) {
        const waId = asString(contact.wa_id);
        const name = isObject(contact.profile) ? asString(contact.profile.name) : undefined;
        if (waId && name) names.set(waId, name);
      }

      for (const message of asObjects(value.messages)) {
        const id = asString(message.id);
        const from = asString(message.from);
        const type = asString(message.type) ?? "unknown";
        if (!id || !from) continue;
        const profileName = names.get(from);

        results.push({
          id,
          userId: from,
          text: messageText(message, type),
          timestamp: parseTimestamp(message.timestamp),
          source: "whatsapp",
          messageType: type,
          ...(profileName ? { profileName } : {}),
          ...(phoneNumberId ? { phoneNumberId } : {}),
          ...(wabaId ? { wabaId } : {})
        });
      }
    }
  }
  return results;
}

export interface WhatsAppStatusUpdate {
  messageId: string;
  status: string;
  timestamp: Date;
  recipientId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  errors: unknown[];
}

export function extractWhatsAppStatuses(payload: unknown): WhatsAppStatusUpdate[] {
  if (!isObject(payload) || payload.object !== "whatsapp_business_account") return [];
  const results: WhatsAppStatusUpdate[] = [];

  for (const entry of asObjects(payload.entry)) {
    const wabaId = asString(entry.id);
    for (const change of asObjects(entry.changes)) {
      if (change.field !== "messages" || !isObject(change.value)) continue;
      const phoneNumberId = isObject(change.value.metadata)
        ? asString(change.value.metadata.phone_number_id)
        : undefined;
      for (const status of asObjects(change.value.statuses)) {
        const messageId = asString(status.id);
        const state = asString(status.status);
        if (!messageId || !state) continue;
        const recipientId = asString(status.recipient_id);
        results.push({
          messageId,
          status: state,
          timestamp: parseTimestamp(status.timestamp),
          ...(recipientId ? { recipientId } : {}),
          ...(wabaId ? { wabaId } : {}),
          ...(phoneNumberId ? { phoneNumberId } : {}),
          errors: Array.isArray(status.errors) ? status.errors : []
        });
      }
    }
  }

  return results;
}
