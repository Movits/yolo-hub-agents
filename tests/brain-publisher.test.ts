import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

async function rewriteMarkdownTree(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await rewriteMarkdownTree(path);
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      const contents = await readFile(path, "utf8");
      await writeFile(path, contents.replace(/\r\n?/g, "\n").normalize("NFD").replaceAll("\n", "\r\n"), "utf8");
    }
  }
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
    expect(first.manifest.evals).toMatchObject({ critical: 12, passed: 12, failed: 0 });
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
    expect(first.manifest.policyInputs.map((input) => input.path)).toEqual([
      "shared/glossary.md",
      "shared/policies/safety-and-handoff.md",
      "agents/empresa-modelo/workflows/human-handoff.md",
      "agents/empresa-modelo/workflows/lead.md",
      "agents/empresa-modelo/workflows/opt-out.md",
      "agents/empresa-modelo/workflows/scheduling.md"
    ]);
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

  it("rejeita datas de calendário impossíveis", async () => {
    await expect(
      compileBrain({ projectRoot, agentId: "empresa-modelo", asOf: "2026-02-30" })
    ).rejects.toThrow("--as-of inválida");
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
    await expect(publishCompiledBrain(releasesRoot, first)).rejects.toThrow(
      "Checksum de business-knowledge.json"
    );
  });

  it("gera os mesmos bytes com Markdown CRLF e Unicode NFD", async () => {
    const fixtureRoot = await copyPublisherFixture();
    await rewriteMarkdownTree(resolve(fixtureRoot, "brain"));
    const expected = await compileBrain({
      projectRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12"
    });
    const converted = await compileBrain({
      projectRoot: fixtureRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12"
    });

    expect(converted.knowledgeBytes).toBe(expected.knowledgeBytes);
    expect(converted.manifestBytes).toBe(expected.manifestBytes);
  });

  it("compõe shared, segmento e agente na ordem declarada", async () => {
    const fixtureRoot = await copyPublisherFixture();
    const segmentRoot = resolve(fixtureRoot, "brain", "segments", "automotivo");
    await mkdir(resolve(segmentRoot, "knowledge"), { recursive: true });
    await writeFile(
      resolve(segmentRoot, "segment.json"),
      `${JSON.stringify(
        {
          schemaVersion: "1.0",
          version: "1.0.0",
          id: "automotivo",
          status: "prototype",
          knowledgeRoots: ["knowledge"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      resolve(segmentRoot, "knowledge", "services.md"),
      `---
id: automotivo.services.core
agent: automotivo
type: services
status: approved
owner: tests
sensitivity: public-business
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: config/company.example.json
---

# Serviço do segmento

\`\`\`json brain-runtime
{
  "schemaVersion": "1.0",
  "kind": "services",
  "value": [
    {
      "id": "segment-service",
      "name": "Serviço do segmento",
      "description": "Serviço adicionado antes da camada do agente.",
      "price": "sob consulta"
    }
  ]
}
\`\`\`
`,
      "utf8"
    );
    const agentManifestPath = resolve(
      fixtureRoot,
      "brain",
      "agents",
      "empresa-modelo",
      "agent.json"
    );
    const agentManifest = JSON.parse(await readFile(agentManifestPath, "utf8")) as {
      extends: string[];
    };
    agentManifest.extends = ["shared", "automotivo"];
    await writeFile(agentManifestPath, `${JSON.stringify(agentManifest, null, 2)}\n`, "utf8");
    const configPath = resolve(fixtureRoot, "config", "company.example.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      services: Array<Record<string, unknown>>;
    };
    config.services.unshift({
      id: "segment-service",
      name: "Serviço do segmento",
      description: "Serviço adicionado antes da camada do agente.",
      price: "sob consulta"
    });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const compiled = await compileBrain({
      projectRoot: fixtureRoot,
      agentId: "empresa-modelo",
      asOf: "2026-07-12"
    });
    expect(compiled.manifest.composition).toEqual([
      { layer: "shared", id: "shared" },
      { layer: "segment", id: "automotivo" },
      { layer: "agent", id: "empresa-modelo" }
    ]);
    expect(compiled.knowledge.services[0]?.id).toBe("segment-service");
    expect(compiled.manifest.inputs[0]?.path).toBe("segments/automotivo/knowledge/services.md");
  });

  it("rejeita root que tenta sair do diretório do agente", async () => {
    const fixtureRoot = await copyPublisherFixture();
    const manifestPath = resolve(
      fixtureRoot,
      "brain",
      "agents",
      "empresa-modelo",
      "agent.json"
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      knowledgeRoots: string[];
    };
    manifest.knowledgeRoots = ["../../../config"];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(
      compileBrain({ projectRoot: fixtureRoot, agentId: "empresa-modelo", asOf: "2026-07-12" })
    ).rejects.toThrow();
  });

  it("exige todas as categorias críticas de avaliação", async () => {
    const fixtureRoot = await copyPublisherFixture();
    const evalPath = resolve(
      fixtureRoot,
      "brain",
      "agents",
      "empresa-modelo",
      "evals",
      "golden-cases.md"
    );
    const contents = (await readFile(evalPath, "utf8")).replace(
      '"category": "redaction"',
      '"category": "grounding"'
    );
    await writeFile(evalPath, contents, "utf8");

    await expect(
      compileBrain({ projectRoot: fixtureRoot, agentId: "empresa-modelo", asOf: "2026-07-12" })
    ).rejects.toThrow("Cobertura crítica ausente: redaction");
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
