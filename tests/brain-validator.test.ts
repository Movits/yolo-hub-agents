import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const validatorPath = resolve("scripts/validate-brain.mjs");
const temporaryProjects: string[] = [];

function frontmatter(source = "approved-source"): string {
  return `---
id: test-agent.faq.core
agent: test-agent
type: faq
status: approved
owner: tests
sensitivity: public-business
version: 1.0.0
effective_from: 2026-07-12
expires_at: null
source: ${source}
---

# FAQ

Resposta aprovada.
`;
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    id: "test-agent",
    displayName: "Test Agent",
    status: "active",
    extends: ["shared"],
    knowledgeRoots: ["knowledge"],
    workflowRoots: ["workflows"],
    evalRoots: ["evals"],
    publishOnlyApproved: true,
    publishSensitivity: ["public", "public-business"],
    ...overrides
  };
}

function createProject(options: {
  manifestValue?: unknown;
  noteSource?: string;
  noteContents?: string;
  leakedJson?: string;
} = {}): string {
  const project = mkdtempSync(join(tmpdir(), "yolo-brain-validator-"));
  temporaryProjects.push(project);
  const agentRoot = join(project, "brain", "agents", "test-agent");
  for (const folder of ["knowledge", "workflows", "evals"]) {
    mkdirSync(join(agentRoot, folder), { recursive: true });
  }
  writeFileSync(
    join(agentRoot, "agent.json"),
    JSON.stringify("manifestValue" in options ? options.manifestValue : manifest(), null, 2),
    "utf8"
  );
  writeFileSync(
    join(agentRoot, "knowledge", "faq.md"),
    options.noteContents ?? frontmatter(options.noteSource),
    "utf8"
  );
  if (options.leakedJson) {
    writeFileSync(join(agentRoot, "leak.json"), options.leakedJson, "utf8");
  }
  return project;
}

function validate(project: string) {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: project,
    encoding: "utf8"
  });
}

afterEach(() => {
  for (const project of temporaryProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe("brain validator", () => {
  it("aceita uma brain mínima e segura", () => {
    const result = validate(createProject());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Brain válida");
  });

  it("recusa manifesto nulo sem encerrar com TypeError", () => {
    const result = validate(createProject({ manifestValue: null }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("manifesto deve ser um objeto JSON");
    expect(result.stderr).not.toContain("TypeError");
  });

  it("recusa herança com path traversal", () => {
    const result = validate(
      createProject({ manifestValue: manifest({ extends: ["shared", "../agents/test-agent"] }) })
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("extends deve incluir shared");
  });

  it("recusa source que sai da raiz declarada", () => {
    const project = createProject({ noteSource: "config/../.env" });
    mkdirSync(join(project, "config"), { recursive: true });
    writeFileSync(join(project, ".env"), "SECRET=fake", "utf8");
    const result = validate(project);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("source local não encontrado");
  });

  it("detecta segredo em JSON da brain", () => {
    const fakeKey = `AKIA${"A".repeat(16)}`;
    const result = validate(createProject({ leakedJson: JSON.stringify({ key: fakeKey }) }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("padrão de segredo detectado");
  });

  it("recusa runtimeConfig com JSON inválido", () => {
    const project = createProject({
      manifestValue: manifest({ runtimeConfig: "../../../config/company.json" })
    });
    mkdirSync(join(project, "config"), { recursive: true });
    writeFileSync(join(project, "config", "company.json"), "{ isto nao e json }", "utf8");
    const result = validate(project);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("runtimeConfig contém JSON inválido");
  });

  it("recusa vigência com expiração anterior ao início", () => {
    const noteContents = frontmatter()
      .replace("effective_from: 2026-07-12", "effective_from: 2026-09-01")
      .replace("expires_at: null", "expires_at: 2026-08-01");
    const result = validate(createProject({ noteContents }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expires_at não pode ser anterior a effective_from");
  });

  it("recusa a mesma raiz em categorias diferentes", () => {
    const result = validate(
      createProject({ manifestValue: manifest({ workflowRoots: ["knowledge"] }) })
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("raiz knowledge repetida");
  });

  it("recusa campo obrigatório contendo apenas espaços", () => {
    const noteContents = frontmatter().replace("owner: tests", 'owner: "   "');
    const result = validate(createProject({ noteContents }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("campo obrigatório ausente: owner");
  });

  it("recusa link Markdown local quebrado", () => {
    const result = validate(
      createProject({ noteContents: `${frontmatter()}\n[Documento](missing.md)\n` })
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("link Markdown não resolvido");
  });

  it("recusa conteúdo confidencial no scaffold público", () => {
    const noteContents = frontmatter().replace(
      "sensitivity: public-business",
      "sensitivity: confidential"
    );
    const result = validate(createProject({ noteContents }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sensitivity inválida: confidential");
  });
});
