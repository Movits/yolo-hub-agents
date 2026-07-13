import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCompanyConfig } from "../src/config/company.js";
import {
  canonicalJson,
  compileBrain,
  evaluatePublishability,
  listPublishedVersions,
  loadPublishedBrainRelease,
  publishCompiledBrain
} from "../src/brain/publisher.js";

const projectRoot = resolve(".");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function copyPublisherFixture(): Promise<string> {
  const directory = await temporaryDirectory("brain-publisher-project-");
  await cp(resolve("brain"), resolve(directory, "brain"), { recursive: true });
  await cp(resolve("config"), resolve(directory, "config"), { recursive: true });
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("brain publisher", () => {
  it("compila bytes determinísticos e equivalentes ao runtimeConfig", async () => {
    const first = await compileBrain({
      projectRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12"
    });
    const second = await compileBrain({
      projectRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12"
    });
    const currentConfig = loadCompanyConfig(resolve("config/company.example.json"));

    expect(first.knowledgeBytes).toBe(second.knowledgeBytes);
    expect(first.manifestBytes).toBe(second.manifestBytes);
    expect(first.manifestSha256).toBe(second.manifestSha256);
    expect(first.knowledgeBytes).toBe(canonicalJson(currentConfig));
    expect(first.manifest.evals).toMatchObject({ critical: 11, passed: 11, failed: 0 });
    expect(first.manifest.inputs.map((input) => input.path)).toEqual([
      "agents/empresa-modelo/knowledge/company.md",
      "agents/empresa-modelo/knowledge/faq.md",
      "agents/empresa-modelo/knowledge/policies.md",
      "agents/empresa-modelo/knowledge/services.md",
      "agents/empresa-modelo/knowledge/support.md",
      "agents/empresa-modelo/knowledge/voice.md"
    ]);
    expect(first.manifest.inputs.some((input) => /workflows|evals|governance/.test(input.path))).toBe(
      false
    );
  });

  it("filtra status, vigência e sensibilidade e rejeita conteúdo confidencial", () => {
    const base = {
      id: "note",
      agent: "empresa-modelo",
      type: "faq",
      status: "approved" as const,
      owner: "owner",
      sensitivity: "public-business" as const,
      version: "1.0.0",
      effective_from: "2026-07-12",
      expires_at: null,
      source: "source"
    };

    expect(evaluatePublishability(base, ["public-business"], "2026-07-12").included).toBe(true);
    expect(
      evaluatePublishability({ ...base, status: "draft" }, ["public-business"], "2026-07-12")
        .reason
    ).toBe("status:draft");
    expect(
      evaluatePublishability(
        { ...base, effective_from: "2026-07-13" },
        ["public-business"],
        "2026-07-12"
      ).reason
    ).toBe("not-yet-effective");
    expect(
      evaluatePublishability(
        { ...base, expires_at: "2026-07-11" },
        ["public-business"],
        "2026-07-12"
      ).reason
    ).toBe("expired");
    expect(() =>
      evaluatePublishability(
        { ...base, sensitivity: "confidential" },
        ["public-business"],
        "2026-07-12"
      )
    ).toThrow("não é permitida");
  });

  it("publica releases imutáveis e permite selecionar uma versão anterior", async () => {
    const releasesRoot = await temporaryDirectory("brain-releases-");
    const first = await compileBrain({
      projectRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12"
    });
    const second = await compileBrain({
      projectRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12",
      versionOverride: "1.1.0"
    });

    expect((await publishCompiledBrain(releasesRoot, first)).created).toBe(true);
    expect((await publishCompiledBrain(releasesRoot, first)).created).toBe(false);
    expect((await publishCompiledBrain(releasesRoot, second)).created).toBe(true);
    expect(await listPublishedVersions(releasesRoot, "empresa-modelo")).toEqual([
      "1.0.0",
      "1.1.0"
    ]);

    const previous = await loadPublishedBrainRelease(releasesRoot, "empresa-modelo", "1.0.0");
    const current = await loadPublishedBrainRelease(releasesRoot, "empresa-modelo", "1.1.0");
    expect(previous.manifest.version).toBe("1.0.0");
    expect(current.manifest.version).toBe("1.1.0");
    expect(previous.knowledge).toEqual(current.knowledge);

    await writeFile(
      resolve(releasesRoot, "empresa-modelo", "1.0.0", "business-knowledge.json"),
      "{}\n",
      "utf8"
    );
    await expect(
      loadPublishedBrainRelease(releasesRoot, "empresa-modelo", "1.0.0")
    ).rejects.toThrow("Checksum do conhecimento");
    await expect(publishCompiledBrain(releasesRoot, first)).rejects.toThrow("imutável");
  });

  it("falha quando o runtimeConfig pertence a outro agente", async () => {
    const fixtureRoot = await copyPublisherFixture();
    const configPath = resolve(fixtureRoot, "config", "company.example.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    config.agentId = "outro-agente";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    await expect(
      compileBrain({
        projectRoot: fixtureRoot,
        agentId: "empresa-modelo",
        asOf: "2026-07-12"
      })
    ).rejects.toThrow("runtimeConfig possui agentId divergente");
  });

  it("bloqueia publicação quando uma avaliação crítica falha", async () => {
    const fixtureRoot = await copyPublisherFixture();
    const servicesPath = resolve(
      fixtureRoot,
      "brain",
      "agents",
      "empresa-modelo",
      "knowledge",
      "services.md"
    );
    const configPath = resolve(fixtureRoot, "config", "company.example.json");
    const services = (await readFile(servicesPath, "utf8")).replaceAll("R$ 199/mês", "R$ 0/mês");
    await writeFile(servicesPath, services, "utf8");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      services: Array<{ price: string }>;
    };
    if (config.services[0]) config.services[0].price = "R$ 0/mês";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    await expect(
      compileBrain({
        projectRoot: fixtureRoot,
        agentId: "empresa-modelo",
        asOf: "2026-07-12"
      })
    ).rejects.toThrow('reply não contém "R$ 199/mês"');
  });
});
