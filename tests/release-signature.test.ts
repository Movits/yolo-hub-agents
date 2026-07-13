import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReleaseSignature,
  verifyReleaseSignature
} from "../src/brain/release-signature.js";
import { loadPinnedKnowledgeRelease } from "../src/config/release.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  releasesRoot: string;
  releaseDirectory: string;
  manifestBytes: Buffer;
  manifestSha256: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "signed-release-"));
  temporaryDirectories.push(directory);
  const releasesRoot = resolve(directory, "releases");
  await cp(resolve("config/releases"), releasesRoot, { recursive: true });
  const releaseDirectory = resolve(releasesRoot, "empresa-modelo/1.0.0");
  return {
    releasesRoot,
    releaseDirectory,
    manifestBytes: await readFile(resolve(releaseDirectory, "manifest.json")),
    manifestSha256: (await readFile(resolve(releaseDirectory, "manifest.sha256"), "utf8")).trim()
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("assinatura Ed25519 de releases", () => {
  it("assina os bytes exatos do manifesto e o loader confirma a chave confiável", async () => {
    const release = await fixture();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const signed = createReleaseSignature(release.manifestBytes, privateKeyPem, "release-test-1");
    await writeFile(resolve(release.releaseDirectory, "manifest.sig.json"), signed.bytes, "utf8");

    const loaded = loadPinnedKnowledgeRelease({
      releasesRoot: release.releasesRoot,
      agentId: "empresa-modelo",
      version: "1.0.0",
      expectedManifestSha256: release.manifestSha256,
      requireSignature: true,
      trustedPublicKeys: { "release-test-1": publicKeyDer }
    });

    expect(loaded.identity).toMatchObject({
      signatureVerified: true,
      signatureKeyId: "release-test-1"
    });
  });

  it("rejeita ausência, chave desconhecida e manifesto adulterado", async () => {
    const release = await fixture();
    expect(() =>
      loadPinnedKnowledgeRelease({
        releasesRoot: release.releasesRoot,
        agentId: "empresa-modelo",
        version: "1.0.0",
        expectedManifestSha256: release.manifestSha256,
        requireSignature: true
      })
    ).toThrow("assinatura Ed25519 obrigatória");

    const { privateKey } = generateKeyPairSync("ed25519");
    const signed = createReleaseSignature(
      release.manifestBytes,
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      "unknown-key"
    );
    expect(() => verifyReleaseSignature(release.manifestBytes, signed.signature, {})).toThrow(
      "não confiável"
    );
    const changed = Buffer.concat([release.manifestBytes, Buffer.from(" ")]);
    expect(() => verifyReleaseSignature(changed, signed.signature, {})).toThrow(
      "outro manifesto"
    );
  });
});
