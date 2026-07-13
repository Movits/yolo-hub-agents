import { describe, expect, it } from "vitest";
import { MetaWhatsAppClient } from "../src/adapters/whatsapp/meta-client.js";

describe("MetaWhatsAppClient", () => {
  it("permite que o phoneNumberId seja fornecido por tenant em cada envio", () => {
    expect(
      () =>
        new MetaWhatsAppClient({
          enabled: true,
          graphVersion: "v25.0",
          accessToken: "test-access-token"
        })
    ).not.toThrow();
  });

  it("continua recusando envio habilitado sem access token", () => {
    expect(
      () => new MetaWhatsAppClient({ enabled: true, graphVersion: "v25.0" })
    ).toThrow("WHATSAPP_ACCESS_TOKEN");
  });
});
