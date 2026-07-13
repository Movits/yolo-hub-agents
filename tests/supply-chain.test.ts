import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error Os verificadores são utilitários ESM JavaScript executados diretamente pelo Node.
import { checkReleaseImmutability } from "../scripts/check-release-immutability.mjs";
// @ts-expect-error Os verificadores são utilitários ESM JavaScript executados diretamente pelo Node.
import { checkAllBrains, discoverAgentIds } from "../scripts/check-all-brains.mjs";
// @ts-expect-error Os verificadores são utilitários ESM JavaScript executados diretamente pelo Node.
import { checkPublicScaffold } from "../scripts/check-public-scaffold.mjs";

const temporaryProjects: string[] = [];

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createProject(): string {
  const project = mkdtempSync(join(tmpdir(), "yolo-supply-chain-"));
  temporaryProjects.push(project);
  return project;
}

function writeRelease(project: string, agentId: string, version: string, answer: string): void {
  const directory = join(project, "config", "releases", agentId, version);
  mkdirSync(directory, { recursive: true });
  const knowledge = `${JSON.stringify({ agentId, answer }, null, 2)}\n`;
  const manifest = `${JSON.stringify(
    {
      agentId,
      version,
      output: {
        file: "business-knowledge.json",
        sha256: sha256(knowledge)
      }
    },
    null,
    2
  )}\n`;
  writeFileSync(join(directory, "business-knowledge.json"), knowledge, "utf8");
  writeFileSync(join(directory, "manifest.json"), manifest, "utf8");
  writeFileSync(join(directory, "manifest.sha256"), `${sha256(manifest)}\n`, "utf8");
}

function git(project: string, args: string[]): string {
  return execFileSync("git", args, { cwd: project, encoding: "utf8" }).trim();
}

function initializeGit(project: string): string {
  git(project, ["init"]);
  git(project, ["config", "user.email", "tests@example.invalid"]);
  git(project, ["config", "user.name", "Supply Chain Tests"]);
  git(project, ["add", "."]);
  git(project, ["commit", "-m", "baseline"]);
  return git(project, ["rev-parse", "HEAD"]);
}

afterEach(() => {
  for (const project of temporaryProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe("release immutability checker", () => {
  it("valida estrutura e checksums sem uma referência-base", () => {
    const project = createProject();
    writeRelease(project, "empresa-modelo", "1.0.0", "original");

    const result = checkReleaseImmutability({ projectRoot: project });

    expect(result.releaseCount).toBe(1);
    expect(result.baseCommit).toBeNull();
  });

  it("permite somente um novo diretório de versão", () => {
    const project = createProject();
    writeRelease(project, "empresa-modelo", "1.0.0", "original");
    const baseRef = initializeGit(project);
    writeRelease(project, "empresa-modelo", "1.1.0", "nova");

    const result = checkReleaseImmutability({ projectRoot: project, baseRef });

    expect(result.newVersions).toEqual(["config/releases/empresa-modelo/1.1.0"]);
  });

  it("rejeita alteração ou remoção de arquivos de uma release existente", () => {
    const project = createProject();
    writeRelease(project, "empresa-modelo", "1.0.0", "original");
    const baseRef = initializeGit(project);
    writeRelease(project, "empresa-modelo", "1.0.0", "mudou");

    expect(() => checkReleaseImmutability({ projectRoot: project, baseRef })).toThrow(
      "Release existente alterada"
    );

    writeRelease(project, "empresa-modelo", "1.0.0", "original");
    unlinkSync(join(project, "config", "releases", "empresa-modelo", "1.0.0", "manifest.sha256"));
    expect(() => checkReleaseImmutability({ projectRoot: project, baseRef })).toThrow(
      /arquivos obrigatórios|Release existente removida/
    );
  });

  it("rejeita adicionar assinatura depois que a versão já existe na base", () => {
    const project = createProject();
    writeRelease(project, "empresa-modelo", "1.0.0", "original");
    const baseRef = initializeGit(project);
    writeFileSync(
      join(
        project,
        "config",
        "releases",
        "empresa-modelo",
        "1.0.0",
        "manifest.sig.json"
      ),
      "{}\n",
      "utf8"
    );

    expect(() => checkReleaseImmutability({ projectRoot: project, baseRef })).toThrow(
      "Arquivo adicionado a uma release existente"
    );
  });
});

describe("all brains checker", () => {
  it("descobre agentes em ordem, ignora o template e verifica cada agente", () => {
    const project = createProject();
    for (const agentId of ["zeta", "_template", "alpha"]) {
      const directory = join(project, "brain", "agents", agentId);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "agent.json"), "{}\n", "utf8");
    }
    const calls: string[] = [];

    expect(discoverAgentIds(project)).toEqual(["alpha", "zeta"]);
    const checked = checkAllBrains({
      projectRoot: project,
      validate: () => calls.push("validate"),
      checkAgent: (_root: string, agentId: string) => calls.push(agentId)
    });

    expect(checked).toEqual(["alpha", "zeta"]);
    expect(calls).toEqual(["validate", "alpha", "zeta"]);
  });

  it("rejeita diretório de agente sem manifesto", () => {
    const project = createProject();
    mkdirSync(resolve(project, "brain", "agents", "sem-manifesto"), { recursive: true });

    expect(() => discoverAgentIds(project)).toThrow("Agente sem agent.json");
  });
});

describe("public scaffold checker", () => {
  it("aceita exemplos fictícios e rejeita identificadores pessoais rastreados", () => {
    const project = createProject();
    const brainDirectory = join(project, "brain", "agents", "demo");
    mkdirSync(brainDirectory, { recursive: true });
    const notePath = join(brainDirectory, "company.md");
    writeFileSync(notePath, "Empresa fictícia: contato@empresa.example\n", "utf8");
    initializeGit(project);

    expect(checkPublicScaffold(project)).toBe(1);
    writeFileSync(notePath, "CPF 123.456.789-00\n", "utf8");
    expect(() => checkPublicScaffold(project)).toThrow("possível dado real");
  });
});
