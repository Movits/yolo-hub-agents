import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaSignature(rawBody: Buffer, signature: string | undefined, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const receivedHex = signature.slice("sha256=".length);
  if (!/^[a-fA-F0-9]{64}$/.test(receivedHex)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(receivedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
