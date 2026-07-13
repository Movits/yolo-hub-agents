import { describe, expect, it } from "vitest";
import {
  extractWhatsAppMessages,
  extractWhatsAppStatuses
} from "../src/adapters/whatsapp/payload.js";

describe("WhatsApp payload parser", () => {
  it("percorre lotes e normaliza texto e respostas interativas", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "phone-1" },
                contacts: [{ wa_id: "5511999", profile: { name: "Ana" } }],
                messages: [
                  {
                    id: "wamid-1",
                    from: "5511999",
                    timestamp: "1783868400",
                    type: "text",
                    text: { body: "Oi" }
                  },
                  {
                    id: "wamid-2",
                    from: "5511888",
                    timestamp: "1783868401",
                    type: "interactive",
                    interactive: { button_reply: { id: "support", title: "Suporte" } }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const messages = extractWhatsAppMessages(payload);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "wamid-1",
      userId: "5511999",
      text: "Oi",
      profileName: "Ana",
      phoneNumberId: "phone-1",
      wabaId: "waba-1"
    });
    expect(messages[1]?.text).toBe("Suporte");
  });

  it("separa status de entrega de mensagens inbound", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-status",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "phone-status" },
                statuses: [
                  {
                    id: "wamid-out",
                    status: "delivered",
                    timestamp: "1783868400",
                    recipient_id: "5511999"
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    expect(extractWhatsAppMessages(payload)).toHaveLength(0);
    expect(extractWhatsAppStatuses(payload)[0]).toMatchObject({
      messageId: "wamid-out",
      status: "delivered",
      recipientId: "5511999",
      wabaId: "waba-status",
      phoneNumberId: "phone-status"
    });
  });
});
