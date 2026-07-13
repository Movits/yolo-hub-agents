import { createHash, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import { BusinessAgent } from "../application/agent.js";
import {
  businessKnowledgeSchema,
  parseBusinessKnowledge
} from "../config/company.js";
import type { BusinessKnowledge } from "../domain/types.js";
import type { TenantContext } from "../domain/tenant.js";
import { MemoryStore } from "../infrastructure/memory-store.js";

const semverPattern = /^\d+\.\d+\.\d+$/;
const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const agentManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    version: z.string().regex(semverPattern),
    id: z.string().regex(slugPattern),
    displayName: z.string().min(1),
    assistantName: z.string().min(1),
    status: z.enum(["prototype", "active"]),
    extends: z.array(z.string().regex(slugPattern)),
    knowledgeRoots: z.array(z.string().min(1)).min(1),
    workflowRoots: z.array(z.string().min(1)),
    evalRoots: z.array(z.string().min(1)).min(1),
    runtimeConfig: z.string().min(1),
    publishOnlyApproved: z.literal(true),
    publishSensitivity: z.array(z.enum(["public", "public-business", "internal"]))
  })
  .strict();

const noteMetadataSchema = z
  .object({
    id: z.string().min(1),
    agent: z.string().min(1),
    type: z.string().min(1),
    status: z.enum(["draft", "in-review", "approved", "retired"]),
    owner: z.string().min(1),
    sensitivity: z.enum([
      "public",
      "public-business",
      "internal",
      "confidential",
      "restricted"
    ]),
    version: z.string().regex(semverPattern),
    effective_from: z.string().regex(datePattern),
    expires_at: z.string().regex(datePattern).nullable(),
    source: z.string().min(1)
  })
  .passthrough();

const companyContributionSchema = z
  .object({
    prototype: businessKnowledgeSchema.shape.prototype,
    notice: businessKnowledgeSchema.shape.notice,
    company: businessKnowledgeSchema.shape.company
  })
  .strict();

const runtimeContributionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      schemaVersion: z.literal("1.0"),
      kind: z.literal("company"),
      value: companyContributionSchema
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("1.0"),
      kind: z.literal("assistant"),
      value: businessKnowledgeSchema.shape.assistant
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("1.0"),
      kind: z.literal("policies"),
      value: businessKnowledgeSchema.shape.policies
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("1.0"),
      kind: z.literal("services"),
      value: businessKnowledgeSchema.shape.services
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("1.0"),
      kind: z.literal("faqs"),
      value: businessKnowledgeSchema.shape.faqs
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("1.0"),
      kind: z.literal("supportProcedures"),
      value: businessKnowledgeSchema.shape.supportProcedures
    })
    .strict()
]);

const evalExpectationSchema = z
  .object({
    intent: z.string().optional(),
    status: z.string().optional(),
    flow: z.string().optional(),
    suppressed: z.boolean().optional(),
    duplicate: z.boolean().optional(),
    handoff: z.boolean().optional(),
    replyNull: z.boolean().optional(),
    replyIncludes: z.array(z.string()).optional(),
    replyExcludes: z.array(z.string()).optional()
  })
  .strict();

const evalSuiteSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    suiteId: z.string().min(1),
    cases: z
      .array(
        z
          .object({
            id: z.string().min(1),
            critical: z.boolean(),
            turns: z
              .array(
                z
                  .object({
                    messageId: z.string().min(1).optional(),
                    text: z.string().min(1),
                    expect: evalExpectationSchema.optional()
                  })
                  .strict()
              )
              .min(1),
            expectStore: z
              .object({
                leads: z.number().int().min(0).optional(),
                appointments: z.number().int().min(0).optional(),
                tickets: z.number().int().min(0).optional()
              })
              .strict()
              .optional()
          })
          .strict()
      )
      .min(1)
  })
  .strict();

const releaseManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    compilerVersion: z.literal("1.0"),
    publicationId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    agentId: z.string().regex(slugPattern),
    version: z.string().regex(semverPattern),
    asOf: z.string().regex(datePattern),
    publishedAt: z.string().datetime(),
    composition: z.array(
      z
        .object({
          layer: z.enum(["shared", "segment", "agent"]),
          id: z.string().min(1)
        })
        .strict()
    ),
    inputs: z.array(
      z
        .object({
          path: z.string().min(1),
          id: z.string().min(1),
          type: z.string().min(1),
          version: z.string().regex(semverPattern),
          sensitivity: z.string().min(1),
          origin: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/)
        })
        .strict()
    ),
    output: z
      .object({
        file: z.literal("business-knowledge.json"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/)
      })
      .strict(),
    evals: z
      .object({
        files: z.array(z.string().min(1)),
        suiteSha256: z.string().regex(/^[a-f0-9]{64}$/),
        critical: z.number().int().positive(),
        passed: z.number().int().positive(),
        failed: z.literal(0)
      })
      .strict()
  })
  .strict();

type AgentManifest = z.infer<typeof agentManifestSchema>;
type NoteMetadata = z.infer<typeof noteMetadataSchema>;
type RuntimeContribution = z.infer<typeof runtimeContributionSchema>;
type EvalSuite = z.infer<typeof evalSuiteSchema>;
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

interface ParsedNote {
  absolutePath: string;
  relativePath: string;
  rawNormalized: string;
  metadata: NoteMetadata;
  body: string;
}

export interface CompileBrainOptions {
  projectRoot: string;
  agentId: string;
  asOf: string;
  versionOverride?: string;
}

export interface CompiledBrainRelease {
  knowledge: BusinessKnowledge;
  knowledgeBytes: string;
  manifest: ReleaseManifest;
  manifestBytes: string;
  manifestSha256: string;
}

function normalizedText(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "string") return value.normalize("NFC");
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function parseScalar(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseNote(absolutePath: string, relativePath: string, raw: string): ParsedNote {
  const normalized = normalizedText(raw);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${relativePath}: frontmatter ausente ou inválido.`);
  const metadata: Record<string, string | null> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(`${relativePath}: linha de frontmatter inválida: ${line}`);
    const key = line.slice(0, separator).trim();
    if (key in metadata) throw new Error(`${relativePath}: campo duplicado no frontmatter: ${key}`);
    metadata[key] = parseScalar(line.slice(separator + 1));
  }
  return {
    absolutePath,
    relativePath,
    rawNormalized: normalized,
    metadata: noteMetadataSchema.parse(metadata),
    body: match[2] ?? ""
  };
}

function extractJsonBlock(body: string, label: "brain-runtime" | "brain-eval"): unknown | null {
  const pattern = new RegExp(`\\x60\\x60\\x60json\\s+${label}\\s*\\n([\\s\\S]*?)\\n\\x60\\x60\\x60`, "g");
  const matches = [...body.matchAll(pattern)];
  if (matches.length > 1) throw new Error(`Mais de um bloco ${label} encontrado.`);
  if (matches.length === 0) return null;
  try {
    return JSON.parse(matches[0]?.[1] ?? "");
  } catch (error) {
    throw new Error(`JSON inválido no bloco ${label}: ${(error as Error).message}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  if (!(await fileExists(root))) return [];
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) throw new Error(`Raiz da brain não é diretório: ${root}`);
  const results: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink não permitido na brain: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) results.push(path);
    }
  };
  await visit(root);
  return results;
}

function posixRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function assertAsOf(asOf: string): void {
  if (!datePattern.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00.000Z`))) {
    throw new Error(`Data --as-of inválida: ${asOf}`);
  }
}

export function evaluatePublishability(
  metadata: NoteMetadata,
  allowedSensitivity: readonly string[],
  asOf: string
): { included: boolean; reason: string } {
  if (["confidential", "restricted"].includes(metadata.sensitivity)) {
    throw new Error(`${metadata.id}: sensibilidade ${metadata.sensitivity} não é permitida.`);
  }
  if (metadata.status !== "approved") return { included: false, reason: `status:${metadata.status}` };
  if (metadata.effective_from > asOf) return { included: false, reason: "not-yet-effective" };
  if (metadata.expires_at && metadata.expires_at < asOf) {
    return { included: false, reason: "expired" };
  }
  if (!allowedSensitivity.includes(metadata.sensitivity)) {
    return { included: false, reason: `sensitivity:${metadata.sensitivity}` };
  }
  return { included: true, reason: "included" };
}

function assertUniqueIds<T extends { id: string }>(values: T[], label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`ID duplicado em ${label}: ${value.id}`);
    ids.add(value.id);
  }
}

function composeKnowledge(agentId: string, contributions: RuntimeContribution[]): BusinessKnowledge {
  const singletons = new Map<string, RuntimeContribution>();
  const services: BusinessKnowledge["services"] = [];
  const faqs: BusinessKnowledge["faqs"] = [];
  const supportProcedures: BusinessKnowledge["supportProcedures"] = [];

  for (const contribution of contributions) {
    if (contribution.kind === "services") services.push(...contribution.value);
    else if (contribution.kind === "faqs") faqs.push(...contribution.value);
    else if (contribution.kind === "supportProcedures") {
      supportProcedures.push(...contribution.value);
    } else {
      if (singletons.has(contribution.kind)) {
        throw new Error(`Contribuição singleton duplicada: ${contribution.kind}`);
      }
      singletons.set(contribution.kind, contribution);
    }
  }

  const company = singletons.get("company");
  const assistant = singletons.get("assistant");
  const policies = singletons.get("policies");
  if (!company || company.kind !== "company") throw new Error("Contribuição company ausente.");
  if (!assistant || assistant.kind !== "assistant") {
    throw new Error("Contribuição assistant ausente.");
  }
  if (!policies || policies.kind !== "policies") {
    throw new Error("Contribuição policies ausente.");
  }
  assertUniqueIds(services, "services");
  assertUniqueIds(faqs, "faqs");
  assertUniqueIds(supportProcedures, "supportProcedures");

  return parseBusinessKnowledge({
    agentId,
    prototype: company.value.prototype,
    notice: company.value.notice,
    assistant: assistant.value,
    company: company.value.company,
    services,
    policies: policies.value,
    faqs,
    supportProcedures
  });
}

function assertExpectation(
  suiteId: string,
  caseId: string,
  turnIndex: number,
  result: Awaited<ReturnType<BusinessAgent["process"]>>,
  expectation: z.infer<typeof evalExpectationSchema>
): void {
  const prefix = `${suiteId}/${caseId}/turn-${turnIndex + 1}`;
  if (expectation.intent !== undefined && result.intent !== expectation.intent) {
    throw new Error(`${prefix}: intent esperado ${expectation.intent}, recebido ${result.intent}.`);
  }
  if (expectation.status !== undefined && result.state.status !== expectation.status) {
    throw new Error(`${prefix}: status esperado ${expectation.status}, recebido ${result.state.status}.`);
  }
  if (expectation.flow !== undefined && result.state.flow !== expectation.flow) {
    throw new Error(`${prefix}: flow esperado ${expectation.flow}, recebido ${result.state.flow}.`);
  }
  for (const field of ["suppressed", "duplicate", "handoff"] as const) {
    if (expectation[field] !== undefined && result[field] !== expectation[field]) {
      throw new Error(`${prefix}: ${field} esperado ${expectation[field]}, recebido ${result[field]}.`);
    }
  }
  if (expectation.replyNull === true && result.reply !== null) {
    throw new Error(`${prefix}: reply deveria ser null.`);
  }
  for (const value of expectation.replyIncludes ?? []) {
    if (!result.reply?.includes(value)) throw new Error(`${prefix}: reply não contém "${value}".`);
  }
  for (const value of expectation.replyExcludes ?? []) {
    if (result.reply?.includes(value)) throw new Error(`${prefix}: reply contém "${value}".`);
  }
}

export async function runCriticalEvals(
  knowledge: BusinessKnowledge,
  suites: EvalSuite[]
): Promise<{ critical: number; passed: number; failed: 0 }> {
  let critical = 0;
  for (const suite of suites) {
    for (const testCase of suite.cases) {
      if (!testCase.critical) continue;
      critical += 1;
      const tenant: TenantContext = {
        tenantId: `eval-${testCase.id}`.slice(0, 100),
        agentId: knowledge.agentId
      };
      const store = new MemoryStore();
      const agent = new BusinessAgent(tenant, knowledge, store);
      for (const [turnIndex, turn] of testCase.turns.entries()) {
        const result = await agent.process({
          id: turn.messageId ?? `${testCase.id}-${turnIndex + 1}`,
          userId: "eval-user",
          text: turn.text,
          timestamp: new Date("2026-01-01T12:00:00.000Z"),
          source: "simulator",
          messageType: "text"
        });
        if (turn.expect) {
          assertExpectation(suite.suiteId, testCase.id, turnIndex, result, turn.expect);
        }
      }
      if (testCase.expectStore) {
        const snapshot = store.snapshot(tenant);
        for (const field of ["leads", "appointments", "tickets"] as const) {
          const expected = testCase.expectStore[field];
          if (expected !== undefined && snapshot[field].length !== expected) {
            throw new Error(
              `${suite.suiteId}/${testCase.id}: ${field} esperado ${expected}, recebido ${snapshot[field].length}.`
            );
          }
        }
      }
    }
  }
  if (critical === 0) throw new Error("Nenhuma avaliação crítica foi encontrada.");
  return { critical, passed: critical, failed: 0 };
}

async function loadAgentManifest(projectRoot: string, agentId: string): Promise<{
  manifest: AgentManifest;
  path: string;
  directory: string;
}> {
  if (!slugPattern.test(agentId)) throw new Error(`agentId inválido: ${agentId}`);
  const directory = resolve(projectRoot, "brain", "agents", agentId);
  const path = resolve(directory, "agent.json");
  const manifest = agentManifestSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  if (manifest.id !== agentId) throw new Error(`Manifesto ${path} declara id divergente.`);
  return { manifest, path, directory };
}

export async function compileBrain(options: CompileBrainOptions): Promise<CompiledBrainRelease> {
  assertAsOf(options.asOf);
  const projectRoot = resolve(options.projectRoot);
  const brainRoot = resolve(projectRoot, "brain");
  const loaded = await loadAgentManifest(projectRoot, options.agentId);
  const releaseVersion = options.versionOverride ?? loaded.manifest.version;
  if (!semverPattern.test(releaseVersion)) throw new Error(`Versão inválida: ${releaseVersion}`);

  const roots: Array<{ layer: "shared" | "segment" | "agent"; id: string; path: string }> = [];
  if (loaded.manifest.extends.includes("shared")) {
    roots.push({ layer: "shared", id: "shared", path: resolve(brainRoot, "shared") });
  }
  for (const extension of loaded.manifest.extends.filter((value) => value !== "shared")) {
    roots.push({
      layer: "segment",
      id: extension,
      path: resolve(brainRoot, "segments", extension)
    });
  }
  for (const knowledgeRoot of loaded.manifest.knowledgeRoots) {
    roots.push({
      layer: "agent",
      id: loaded.manifest.id,
      path: resolve(loaded.directory, knowledgeRoot)
    });
  }

  const notes: ParsedNote[] = [];
  const seenPaths = new Set<string>();
  for (const root of roots) {
    for (const absolutePath of await listMarkdownFiles(root.path)) {
      const relativePath = posixRelative(brainRoot, absolutePath);
      if (seenPaths.has(relativePath)) continue;
      seenPaths.add(relativePath);
      const note = parseNote(absolutePath, relativePath, await readFile(absolutePath, "utf8"));
      const expectedAgent = root.layer === "shared" ? "shared" : root.id;
      if (note.metadata.agent !== expectedAgent) {
        throw new Error(`${relativePath}: agent esperado ${expectedAgent}, recebido ${note.metadata.agent}.`);
      }
      notes.push(note);
    }
  }
  notes.sort((left, right) => compareText(left.relativePath, right.relativePath));

  const contributions: RuntimeContribution[] = [];
  const inputEntries: ReleaseManifest["inputs"] = [];
  for (const note of notes) {
    const decision = evaluatePublishability(
      note.metadata,
      loaded.manifest.publishSensitivity,
      options.asOf
    );
    if (!decision.included) continue;
    const block = extractJsonBlock(note.body, "brain-runtime");
    if (block === null) {
      if (note.relativePath.startsWith(`agents/${options.agentId}/`)) {
        throw new Error(`${note.relativePath}: nota publicável sem bloco brain-runtime.`);
      }
      continue;
    }
    contributions.push(runtimeContributionSchema.parse(block));
    inputEntries.push({
      path: note.relativePath,
      id: note.metadata.id,
      type: note.metadata.type,
      version: note.metadata.version,
      sensitivity: note.metadata.sensitivity,
      origin: note.metadata.source,
      sha256: sha256(note.rawNormalized)
    });
  }
  if (contributions.length === 0) throw new Error("Nenhuma contribuição publicável encontrada.");
  const knowledge = composeKnowledge(options.agentId, contributions);

  const configRoot = resolve(projectRoot, "config");
  const runtimeConfigPath = resolve(loaded.directory, loaded.manifest.runtimeConfig);
  if (!runtimeConfigPath.startsWith(`${configRoot}${sep}`)) {
    throw new Error("runtimeConfig deve permanecer dentro de config/.");
  }
  const runtimeConfigLinkStats = await lstat(runtimeConfigPath);
  if (runtimeConfigLinkStats.isSymbolicLink()) {
    throw new Error("runtimeConfig não pode ser symlink.");
  }
  const runtimeConfigStats = await stat(runtimeConfigPath);
  if (!runtimeConfigStats.isFile()) throw new Error("runtimeConfig não aponta para arquivo regular.");
  const runtimeConfig = parseBusinessKnowledge(
    JSON.parse(await readFile(runtimeConfigPath, "utf8")) as unknown
  );
  if (runtimeConfig.agentId !== options.agentId) {
    throw new Error("runtimeConfig possui agentId divergente do manifesto.");
  }
  if (canonicalJson(runtimeConfig) !== canonicalJson(knowledge)) {
    throw new Error("Brain compilada diverge do runtimeConfig de migração.");
  }

  const evalFiles: string[] = [];
  for (const evalRoot of loaded.manifest.evalRoots) {
    for (const absolutePath of await listMarkdownFiles(resolve(loaded.directory, evalRoot))) {
      const relativePath = posixRelative(brainRoot, absolutePath);
      const note = parseNote(absolutePath, relativePath, await readFile(absolutePath, "utf8"));
      if (note.metadata.agent !== options.agentId) {
        throw new Error(`${relativePath}: eval pertence a outro agente.`);
      }
      const decision = evaluatePublishability(
        note.metadata,
        ["public", "public-business", "internal"],
        options.asOf
      );
      if (!decision.included) continue;
      const block = extractJsonBlock(note.body, "brain-eval");
      if (block === null) throw new Error(`${relativePath}: eval aprovada sem bloco brain-eval.`);
      evalFiles.push(relativePath);
    }
  }
  evalFiles.sort(compareText);
  const suites: EvalSuite[] = [];
  for (const relativePath of evalFiles) {
    const raw = await readFile(resolve(brainRoot, relativePath), "utf8");
    const note = parseNote(resolve(brainRoot, relativePath), relativePath, raw);
    suites.push(evalSuiteSchema.parse(extractJsonBlock(note.body, "brain-eval")));
  }
  const evalResult = await runCriticalEvals(knowledge, suites);
  const suiteSha256 = sha256(canonicalJson(suites));
  const knowledgeBytes = canonicalJson(knowledge);
  const knowledgeSha256 = sha256(knowledgeBytes);
  const publicationId = `sha256:${sha256(
    canonicalJson({
      compilerVersion: "1.0",
      agentId: options.agentId,
      version: releaseVersion,
      asOf: options.asOf,
      inputs: inputEntries,
      knowledgeSha256,
      suiteSha256
    })
  )}`;
  const manifest: ReleaseManifest = releaseManifestSchema.parse({
    schemaVersion: "1.0",
    compilerVersion: "1.0",
    publicationId,
    agentId: options.agentId,
    version: releaseVersion,
    asOf: options.asOf,
    publishedAt: `${options.asOf}T00:00:00.000Z`,
    composition: roots.map(({ layer, id }) => ({ layer, id })),
    inputs: inputEntries,
    output: { file: "business-knowledge.json", sha256: knowledgeSha256 },
    evals: {
      files: evalFiles,
      suiteSha256,
      ...evalResult
    }
  });
  const manifestBytes = canonicalJson(manifest);
  return {
    knowledge,
    knowledgeBytes,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes)
  };
}

async function readReleaseBytes(directory: string): Promise<{
  knowledgeBytes: string;
  manifestBytes: string;
  manifestSha256: string;
}> {
  return {
    knowledgeBytes: await readFile(resolve(directory, "business-knowledge.json"), "utf8"),
    manifestBytes: await readFile(resolve(directory, "manifest.json"), "utf8"),
    manifestSha256: (await readFile(resolve(directory, "manifest.sha256"), "utf8")).trim()
  };
}

export async function publishCompiledBrain(
  releasesRoot: string,
  compiled: CompiledBrainRelease
): Promise<{ directory: string; created: boolean }> {
  const root = resolve(releasesRoot);
  const agentDirectory = resolve(root, compiled.manifest.agentId);
  const directory = resolve(agentDirectory, compiled.manifest.version);
  if (await fileExists(directory)) {
    const existing = await readReleaseBytes(directory);
    if (
      existing.knowledgeBytes !== compiled.knowledgeBytes ||
      existing.manifestBytes !== compiled.manifestBytes ||
      existing.manifestSha256 !== compiled.manifestSha256
    ) {
      throw new Error(`Release imutável já existe com conteúdo diferente: ${directory}`);
    }
    return { directory, created: false };
  }

  await mkdir(agentDirectory, { recursive: true });
  const temporary = resolve(agentDirectory, `.tmp-${compiled.manifest.version}-${randomUUID()}`);
  await mkdir(temporary);
  try {
    await writeFile(resolve(temporary, "business-knowledge.json"), compiled.knowledgeBytes, "utf8");
    await writeFile(resolve(temporary, "manifest.json"), compiled.manifestBytes, "utf8");
    await writeFile(resolve(temporary, "manifest.sha256"), `${compiled.manifestSha256}\n`, "utf8");
    await rename(temporary, directory);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { directory, created: true };
}

export async function loadPublishedBrainRelease(
  releasesRoot: string,
  agentId: string,
  version: string
): Promise<{ manifest: ReleaseManifest; knowledge: BusinessKnowledge; manifestSha256: string }> {
  if (!slugPattern.test(agentId)) throw new Error(`agentId inválido: ${agentId}`);
  if (!semverPattern.test(version)) throw new Error(`versão inválida: ${version}`);
  const directory = resolve(releasesRoot, agentId, version);
  const bytes = await readReleaseBytes(directory);
  const manifest = releaseManifestSchema.parse(JSON.parse(bytes.manifestBytes) as unknown);
  if (manifest.agentId !== agentId || manifest.version !== version) {
    throw new Error("Manifesto diverge da release selecionada.");
  }
  if (sha256(bytes.manifestBytes) !== bytes.manifestSha256) {
    throw new Error("Checksum do manifesto é inválido.");
  }
  if (sha256(bytes.knowledgeBytes) !== manifest.output.sha256) {
    throw new Error("Checksum do conhecimento é inválido.");
  }
  const knowledge = parseBusinessKnowledge(JSON.parse(bytes.knowledgeBytes) as unknown);
  if (knowledge.agentId !== agentId) throw new Error("Conhecimento pertence a outro agente.");
  return { manifest, knowledge, manifestSha256: bytes.manifestSha256 };
}

export async function listPublishedVersions(
  releasesRoot: string,
  agentId: string
): Promise<string[]> {
  if (!slugPattern.test(agentId)) throw new Error(`agentId inválido: ${agentId}`);
  const directory = resolve(releasesRoot, agentId);
  if (!(await fileExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && semverPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareText);
}

export function defaultReleasesRoot(projectRoot: string): string {
  return resolve(projectRoot, "config", "releases");
}

export function releaseDirectory(
  releasesRoot: string,
  agentId: string,
  version: string
): string {
  return resolve(releasesRoot, agentId, version);
}
