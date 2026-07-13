import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { z } from "zod";

const keyIdPattern = /^[a-z0-9][a-z0-9._-]*$/;

export const releaseSignatureSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    algorithm: z.literal("Ed25519"),
    keyId: z.string().regex(keyIdPattern),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().min(1)
  })
  .strict();

export type ReleaseSignature = z.infer<typeof releaseSignatureSchema>;
export type TrustedReleaseKeys = Readonly<Record<string, string>>;

const trustedReleaseKeysSchema = z.record(
  z.string().regex(keyIdPattern),
  z.string().min(1)
);

export function parseTrustedReleaseKeys(value: string | undefined): TrustedReleaseKeys {
  if (!value) return {};
  try {
    return trustedReleaseKeysSchema.parse(JSON.parse(value) as unknown);
  } catch (error) {
    throw new Error(`RELEASE_TRUSTED_PUBLIC_KEYS inválido: ${(error as Error).message}`);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createReleaseSignature(
  manifestBytes: Uint8Array,
  privateKeyPem: string,
  keyId: string
): { signature: ReleaseSignature; bytes: string } {
  if (!keyIdPattern.test(keyId)) throw new Error("keyId de assinatura inválido.");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("A chave de assinatura deve ser Ed25519.");
  }
  const signature = releaseSignatureSchema.parse({
    schemaVersion: "1.0",
    algorithm: "Ed25519",
    keyId,
    manifestSha256: sha256Hex(manifestBytes),
    signature: sign(null, manifestBytes, privateKey).toString("base64")
  });
  return { signature, bytes: `${JSON.stringify(signature, null, 2)}\n` };
}

export function verifyReleaseSignature(
  manifestBytes: Uint8Array,
  rawSignature: unknown,
  trustedKeys: TrustedReleaseKeys
): ReleaseSignature {
  const signature = releaseSignatureSchema.parse(rawSignature);
  if (signature.manifestSha256 !== sha256Hex(manifestBytes)) {
    throw new Error("Assinatura referencia outro manifesto.");
  }
  const encodedPublicKey = trustedKeys[signature.keyId];
  if (!encodedPublicKey) throw new Error(`Chave de assinatura não confiável: ${signature.keyId}`);
  const publicKey = createPublicKey({
    key: Buffer.from(encodedPublicKey, "base64"),
    format: "der",
    type: "spki"
  });
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("A chave pública confiável deve ser Ed25519.");
  }
  if (!verify(null, manifestBytes, publicKey, Buffer.from(signature.signature, "base64"))) {
    throw new Error("Assinatura Ed25519 da release é inválida.");
  }
  return signature;
}
