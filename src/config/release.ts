import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { releaseManifestSchema, type ReleaseManifest } from "../brain/release-contract.js";
import {
  verifyReleaseSignature,
  type TrustedReleaseKeys
} from "../brain/release-signature.js";
import type { BusinessKnowledge } from "../domain/types.js";
import { parseBusinessKnowledge } from "./company.js";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumManifestBytes = 1024 * 1024;
const maximumKnowledgeBytes = 5 * 1024 * 1024;

export interface ReleaseIdentity {
  agentId: string;
  version: string;
  manifestSha256: string;
  signatureVerified: boolean;
  signatureKeyId?: string;
}

export interface KnowledgeRelease {
  identity: ReleaseIdentity;
  knowledge: BusinessKnowledge;
  source: "published" | "dev-fallback";
  manifest?: ReleaseManifest;
}

export interface LoadPinnedReleaseOptions {
  releasesRoot: string;
  agentId: string;
  version: string;
  expectedManifestSha256: string;
  requireSignature?: boolean;
  trustedPublicKeys?: TrustedReleaseKeys;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "string") return value.normalize("NFC");
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}

function calculatePublicationId(manifest: ReleaseManifest): string {
  const payload = {
    compilerVersion: manifest.compilerVersion,
    agentId: manifest.agentId,
    version: manifest.version,
    asOf: manifest.asOf,
    composition: manifest.composition,
    inputs: manifest.inputs,
    policyInputs: manifest.policyInputs,
    knowledgeSha256: manifest.output.sha256,
    suiteSha256: manifest.evals.suiteSha256
  };
  return `sha256:${sha256(Buffer.from(`${JSON.stringify(canonicalValue(payload), null, 2)}\n`))}`;
}

function assertRegularFile(path: string, maximumBytes: number): void {
  const linkStats = lstatSync(path);
  if (linkStats.isSymbolicLink()) throw new Error(`Symlink não permitido na release: ${path}`);
  const fileStats = statSync(path);
  if (!fileStats.isFile()) throw new Error(`Arquivo regular esperado na release: ${path}`);
  if (fileStats.size > maximumBytes) throw new Error(`Arquivo de release excede o limite: ${path}`);
}

function assertDirectory(path: string): void {
  const linkStats = lstatSync(path);
  if (linkStats.isSymbolicLink()) throw new Error(`Symlink não permitido na release: ${path}`);
  if (!linkStats.isDirectory()) throw new Error(`Diretório de release esperado: ${path}`);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} contém JSON inválido: ${(error as Error).message}`);
  }
}

export function createDevelopmentRelease(knowledge: BusinessKnowledge): KnowledgeRelease {
  return {
    identity: {
      agentId: knowledge.agentId,
      version: "dev-fallback",
      manifestSha256: "unverified-dev-fallback",
      signatureVerified: false
    },
    knowledge,
    source: "dev-fallback"
  };
}

export function loadPinnedKnowledgeRelease(
  options: LoadPinnedReleaseOptions
): KnowledgeRelease {
  if (!slugPattern.test(options.agentId)) throw new Error(`AGENT_ID inválido: ${options.agentId}`);
  if (!semverPattern.test(options.version)) {
    throw new Error(`AGENT_RELEASE_VERSION inválida: ${options.version}`);
  }
  const expectedManifestSha256 = options.expectedManifestSha256.toLowerCase();
  if (!sha256Pattern.test(expectedManifestSha256)) {
    throw new Error("AGENT_RELEASE_MANIFEST_SHA256 deve ser um SHA-256 hexadecimal.");
  }

  const releasesRoot = resolve(options.releasesRoot);
  const agentDirectory = resolve(releasesRoot, options.agentId);
  const releaseDirectory = resolve(agentDirectory, options.version);
  assertDirectory(releasesRoot);
  assertDirectory(agentDirectory);
  assertDirectory(releaseDirectory);

  const manifestPath = resolve(releaseDirectory, "manifest.json");
  const checksumPath = resolve(releaseDirectory, "manifest.sha256");
  const knowledgePath = resolve(releaseDirectory, "business-knowledge.json");
  const signaturePath = resolve(releaseDirectory, "manifest.sig.json");
  assertRegularFile(manifestPath, maximumManifestBytes);
  assertRegularFile(checksumPath, 256);
  assertRegularFile(knowledgePath, maximumKnowledgeBytes);

  const manifestBytes = readFileSync(manifestPath);
  const actualManifestSha256 = sha256(manifestBytes);
  const recordedManifestSha256 = readFileSync(checksumPath, "utf8").trim().toLowerCase();
  if (recordedManifestSha256 !== actualManifestSha256) {
    throw new Error("manifest.sha256 não corresponde aos bytes de manifest.json.");
  }
  if (expectedManifestSha256 !== actualManifestSha256) {
    throw new Error("Manifesto da release não corresponde ao SHA-256 fixado no ambiente.");
  }

  const manifest = releaseManifestSchema.parse(parseJson(manifestBytes, "manifest.json"));
  if (manifest.agentId !== options.agentId || manifest.version !== options.version) {
    throw new Error("Manifesto diverge do agente ou versão selecionados.");
  }
  if (manifest.publicationId !== calculatePublicationId(manifest)) {
    throw new Error("publicationId do manifesto é inválido.");
  }

  let signatureKeyId: string | undefined;
  if (existsSync(signaturePath)) {
    assertRegularFile(signaturePath, 16 * 1024);
    const verified = verifyReleaseSignature(
      manifestBytes,
      parseJson(readFileSync(signaturePath), "manifest.sig.json"),
      options.trustedPublicKeys ?? {}
    );
    signatureKeyId = verified.keyId;
  } else if (options.requireSignature) {
    throw new Error("Release selecionada não possui assinatura Ed25519 obrigatória.");
  }

  const knowledgeBytes = readFileSync(knowledgePath);
  if (sha256(knowledgeBytes) !== manifest.output.sha256) {
    throw new Error("Checksum de business-knowledge.json não corresponde ao manifesto.");
  }
  const knowledge = parseBusinessKnowledge(
    parseJson(knowledgeBytes, "business-knowledge.json")
  );
  if (knowledge.agentId !== options.agentId) {
    throw new Error("Conhecimento publicado pertence a outro agente.");
  }

  return {
    identity: {
      agentId: options.agentId,
      version: options.version,
      manifestSha256: actualManifestSha256,
      signatureVerified: signatureKeyId !== undefined,
      ...(signatureKeyId ? { signatureKeyId } : {})
    },
    knowledge,
    source: "published",
    manifest
  };
}
