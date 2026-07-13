import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileBrain, publishCompiledBrain } from "../src/brain/publisher.js";
import { releaseManifestSchema } from "../src/brain/release-contract.js";
import { loadCompanyConfig } from "../src/config/company.js";
import { loadEnv } from "../src/config/env.js";
import {
  createDevelopmentRelease,
  loadPinnedKnowledgeRelease
} from "../src/config/release.js";
import { createRuntime } from "../src/runtime.js";

const projectRoot = resolve(".");
const trackedReleasesRoot = resolve("config/releases");
const trackedChecksumPath = resolve(
  trackedReleasesRoot,
  "empresa-modelo/1.0.0/manifest.sha256"
);
const temporaryDirectories: string[] = [];

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function copiedReleasesRoot(): Promise<string> {
  const directory = await temporaryDirectory("brain-release-");
  const root = resolve(directory, "releases");
  await cp(trackedReleasesRoot, root, { recursive: true });
  return root;
}

async function trackedManifestSha256(): Promise<string> {
  return (await readFile(trackedChecksumPath, "utf8")).trim();
}

function selectedEnv(
  releasesRoot: string,
  version: string,
  manifestSha256: string,
  nodeEnv: "development" | "test" | "production" = "test"
) {
  return loadEnv({
    NODE_ENV: nodeEnv,
    LOG_LEVEL: "silent",
    COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
    AGENT_ID: "empresa-modelo",
    AGENT_RELEASE_VERSION: version,
    AGENT_RELEASE_MANIFEST_SHA256: manifestSha256,
    AGENT_RELEASES_ROOT: releasesRoot,
    OPENAI_API_KEY: "",
    WHATSAPP_SEND_ENABLED: "false"
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("runtime fixado em release", () => {
  it("carrega a release publicada selecionada por agente, versão e checksum", async () => {
    const manifestSha256 = await trackedManifestSha256();
    const release = loadPinnedKnowledgeRelease({
      releasesRoot: trackedReleasesRoot,
      agentId: "empresa-modelo",
      version: "1.0.0",
      expectedManifestSha256: manifestSha256
    });

    expect(release.source).toBe("published");
    expect(release.identity).toEqual({
      agentId: "empresa-modelo",
      version: "1.0.0",
      manifestSha256
    });
    expect(release.knowledge.agentId).toBe("empresa-modelo");
  });

  it("rejeita checksum fixado incorreto e release ausente", () => {
    expect(() =>
      loadPinnedKnowledgeRelease({
        releasesRoot: trackedReleasesRoot,
        agentId: "empresa-modelo",
        version: "1.0.0",
        expectedManifestSha256: "0".repeat(64)
      })
    ).toThrow("fixado no ambiente");

    expect(() =>
      loadPinnedKnowledgeRelease({
        releasesRoot: trackedReleasesRoot,
        agentId: "empresa-modelo",
        version: "9.9.9",
        expectedManifestSha256: "0".repeat(64)
      })
    ).toThrow();
  });

  it("rejeita conhecimento adulterado mesmo com manifesto intacto", async () => {
    const releasesRoot = await copiedReleasesRoot();
    const manifestSha256 = await trackedManifestSha256();
    const knowledgePath = resolve(
      releasesRoot,
      "empresa-modelo/1.0.0/business-knowledge.json"
    );
    await writeFile(knowledgePath, `${await readFile(knowledgePath, "utf8")} `, "utf8");

    expect(() =>
      loadPinnedKnowledgeRelease({
        releasesRoot,
        agentId: "empresa-modelo",
        version: "1.0.0",
        expectedManifestSha256: manifestSha256
      })
    ).toThrow("business-knowledge.json");
  });

  it("rejeita manifesto adulterado mesmo quando sidecar e pin também foram recalculados", async () => {
    const releasesRoot = await copiedReleasesRoot();
    const releaseDirectory = resolve(releasesRoot, "empresa-modelo/1.0.0");
    const manifestPath = resolve(releaseDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.composition = [
      ...(manifest.composition as unknown[]),
      { layer: "segment", id: "segmento-injetado" }
    ];
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const manifestSha256 = sha256(manifestBytes);
    await writeFile(manifestPath, manifestBytes);
    await writeFile(resolve(releaseDirectory, "manifest.sha256"), `${manifestSha256}\n`, "utf8");

    expect(() =>
      loadPinnedKnowledgeRelease({
        releasesRoot,
        agentId: "empresa-modelo",
        version: "1.0.0",
        expectedManifestSha256: manifestSha256
      })
    ).toThrow("publicationId");
  });

  it("permite fallback apenas em desenvolvimento/teste e nunca para seletor parcial", () => {
    const development = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
      OPENAI_API_KEY: "",
      WHATSAPP_SEND_ENABLED: "false"
    });
    const fallback = createRuntime({ env: development, llm: null });
    expect(fallback.release.source).toBe("dev-fallback");
    expect(fallback.release.identity.version).toBe("dev-fallback");
    const knowledge = loadCompanyConfig(resolve("config/company.example.json"));
    expect(() =>
      createRuntime({
        env: development,
        knowledge,
        release: createDevelopmentRelease(knowledge),
        llm: null
      })
    ).toThrow("Não combine overrides");

    const partial = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
      AGENT_ID: "empresa-modelo",
      OPENAI_API_KEY: "",
      WHATSAPP_SEND_ENABLED: "false"
    });
    expect(() => createRuntime({ env: partial, llm: null })).toThrow("incompleta");
  });

  it("rejeita contadores inconsistentes de avaliações no contrato da release", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(trackedReleasesRoot, "empresa-modelo/1.0.0/manifest.json"), "utf8")
    ) as { evals: { passed: number } };
    manifest.evals.passed = 1;

    expect(() => releaseManifestSchema.parse(manifest)).toThrow("passed deve ser igual");
  });

  it("falha fechado em produção sem release e rejeita override direto", () => {
    const productionWithoutRelease = loadEnv({
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      COMPANY_CONFIG_PATH: resolve("config/company.example.json"),
      OPENAI_API_KEY: "",
      WHATSAPP_SEND_ENABLED: "false"
    });
    expect(() => createRuntime({ env: productionWithoutRelease, llm: null })).toThrow(
      "explicitamente fixada"
    );

    const productionWithRelease = selectedEnv(
      trackedReleasesRoot,
      "1.0.0",
      "0".repeat(64),
      "production"
    );
    expect(() =>
      createRuntime({
        env: productionWithRelease,
        knowledge: loadCompanyConfig(resolve("config/company.example.json")),
        llm: null
      })
    ).toThrow("override direto");
  });

  it("propaga a versão selecionada e permite rollback explícito", async () => {
    const releasesRoot = resolve(await temporaryDirectory("brain-rollback-"), "releases");
    const release100 = await compileBrain({
      projectRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12",
      versionOverride: "1.0.0"
    });
    const release110 = await compileBrain({
      projectRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12",
      versionOverride: "1.1.0"
    });
    await publishCompiledBrain(releasesRoot, release100);
    await publishCompiledBrain(releasesRoot, release110);

    const current = createRuntime({
      env: selectedEnv(releasesRoot, "1.1.0", release110.manifestSha256),
      llm: null
    });
    const currentResult = await current.agent.process({
      id: "release-current",
      userId: "release-user",
      text: "Oi",
      timestamp: new Date("2026-07-12T12:00:00.000Z"),
      source: "simulator",
      messageType: "text"
    });
    expect(currentResult.releaseVersion).toBe("1.1.0");

    const rolledBack = createRuntime({
      env: selectedEnv(releasesRoot, "1.0.0", release100.manifestSha256),
      llm: null
    });
    const rollbackResult = await rolledBack.agent.process({
      id: "release-rollback",
      userId: "release-user",
      text: "Oi",
      timestamp: new Date("2026-07-12T12:01:00.000Z"),
      source: "simulator",
      messageType: "text"
    });
    expect(rollbackResult.releaseVersion).toBe("1.0.0");
    expect(rolledBack.knowledge).toEqual(current.knowledge);
  });
});
