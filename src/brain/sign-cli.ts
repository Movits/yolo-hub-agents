import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import { resolve } from "node:path";
import { createReleaseSignature } from "./release-signature.js";
import { defaultReleasesRoot, releaseDirectory } from "./publisher.js";
import { loadPinnedKnowledgeRelease } from "../config/release.js";

interface Options {
  agentId: string;
  version: string;
  keyId: string;
  privateKeyPath: string;
  releasesRoot: string;
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  const allowed = new Set(["--agent", "--version", "--key-id", "--private-key", "--out"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Argumento inválido: ${name ?? "ausente"}`);
    }
    if (!allowed.has(name)) throw new Error(`Argumento desconhecido: ${name}`);
    values.set(name, value);
  }
  const agentId = values.get("--agent");
  const version = values.get("--version");
  const keyId = values.get("--key-id");
  const privateKey = values.get("--private-key");
  if (!agentId || !version || !keyId || !privateKey) {
    throw new Error(
      "Uso: brain:sign --agent <id> --version <semver> --key-id <id> --private-key <arquivo.pem>"
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(agentId)) throw new Error("agentId inválido.");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("version deve usar semver.");
  return {
    agentId,
    version,
    keyId,
    privateKeyPath: resolve(privateKey),
    releasesRoot: resolve(values.get("--out") ?? defaultReleasesRoot(process.cwd()))
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const directory = releaseDirectory(options.releasesRoot, options.agentId, options.version);
  const manifestPath = resolve(directory, "manifest.json");
  const checksumPath = resolve(directory, "manifest.sha256");
  const signaturePath = resolve(directory, "manifest.sig.json");
  for (const path of [manifestPath, checksumPath, options.privateKeyPath]) {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Arquivo regular esperado: ${path}`);
  }
  const manifestSha256 = readFileSync(checksumPath, "utf8").trim();
  const privateKeyPem = readFileSync(options.privateKeyPath, "utf8");
  const signed = createReleaseSignature(
    readFileSync(manifestPath),
    privateKeyPem,
    options.keyId
  );
  const publicKey = createPublicKey(privateKeyPem)
    .export({ format: "der", type: "spki" })
    .toString("base64");
  loadPinnedKnowledgeRelease({
    releasesRoot: options.releasesRoot,
    agentId: options.agentId,
    version: options.version,
    expectedManifestSha256: manifestSha256,
    requireSignature: existsSync(signaturePath),
    trustedPublicKeys: { [options.keyId]: publicKey }
  });
  if (existsSync(signaturePath)) {
    const stats = lstatSync(signaturePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Sidecar de assinatura inválido: ${signaturePath}`);
    }
    if (readFileSync(signaturePath, "utf8") !== signed.bytes) {
      throw new Error("A release já possui uma assinatura diferente e não pode ser sobrescrita.");
    }
    process.stdout.write(`Assinatura já existente e idêntica: ${signaturePath}\n`);
    return;
  }
  writeFileSync(signaturePath, signed.bytes, { encoding: "utf8", flag: "wx", mode: 0o644 });
  process.stdout.write(`Release assinada com ${options.keyId}: ${signaturePath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
