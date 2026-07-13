import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const agentPattern = /^[a-z0-9][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const expectedReleaseFiles = [
  "business-knowledge.json",
  "manifest.json",
  "manifest.sha256"
];
const optionalReleaseFiles = ["manifest.sig.json"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function repositoryPath(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

function assertDirectory(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado: ${path}`);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} deve ser um diretório regular: ${path}`);
  }
}

function assertRegularFile(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Arquivo regular esperado na release: ${path}`);
  }
}

function parseManifest(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("objeto JSON esperado");
    }
    return value;
  } catch (error) {
    throw new Error(`Manifesto inválido em ${path}: ${error.message}`);
  }
}

function sortedEntries(path) {
  return readdirSync(path, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en")
  );
}

/**
 * Valida a estrutura e os checksums de todas as releases presentes no workspace.
 * Retorna os arquivos para que a verificação contra a base use exatamente a árvore validada.
 */
export function validateReleaseStructure(projectRoot = process.cwd()) {
  const root = resolve(projectRoot);
  const releasesRoot = resolve(root, "config", "releases");
  assertDirectory(releasesRoot, "Raiz de releases");

  const files = new Map();
  let releaseCount = 0;
  for (const agentEntry of sortedEntries(releasesRoot)) {
    const agentPath = resolve(releasesRoot, agentEntry.name);
    if (
      !agentPattern.test(agentEntry.name) ||
      agentEntry.isSymbolicLink() ||
      !agentEntry.isDirectory()
    ) {
      throw new Error(`Entrada de agente inválida na árvore de releases: ${agentEntry.name}`);
    }

    let agentReleaseCount = 0;
    for (const versionEntry of sortedEntries(agentPath)) {
      const versionPath = resolve(agentPath, versionEntry.name);
      if (
        !semverPattern.test(versionEntry.name) ||
        versionEntry.isSymbolicLink() ||
        !versionEntry.isDirectory()
      ) {
        throw new Error(
          `Versão inválida em config/releases/${agentEntry.name}: ${versionEntry.name}`
        );
      }

      const names = sortedEntries(versionPath).map((entry) => {
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new Error(`Release contém entrada que não é arquivo regular: ${entry.name}`);
        }
        return entry.name;
      });
      const allowedNames = new Set([...expectedReleaseFiles, ...optionalReleaseFiles]);
      if (
        expectedReleaseFiles.some((name) => !names.includes(name)) ||
        names.some((name) => !allowedNames.has(name))
      ) {
        throw new Error(
          `Release ${agentEntry.name}@${versionEntry.name} deve conter os arquivos obrigatórios e somente sidecars permitidos.`
        );
      }

      const manifestPath = resolve(versionPath, "manifest.json");
      const checksumPath = resolve(versionPath, "manifest.sha256");
      const knowledgePath = resolve(versionPath, "business-knowledge.json");
      for (const path of [manifestPath, checksumPath, knowledgePath]) assertRegularFile(path);

      const manifestBytes = readFileSync(manifestPath);
      const recordedManifestSha256 = readFileSync(checksumPath, "utf8").trim().toLowerCase();
      if (!sha256Pattern.test(recordedManifestSha256)) {
        throw new Error(`manifest.sha256 inválido em ${agentEntry.name}@${versionEntry.name}`);
      }
      if (sha256(manifestBytes) !== recordedManifestSha256) {
        throw new Error(`Checksum do manifesto inválido em ${agentEntry.name}@${versionEntry.name}`);
      }

      const manifest = parseManifest(manifestPath);
      if (manifest.agentId !== agentEntry.name || manifest.version !== versionEntry.name) {
        throw new Error(
          `Manifesto diverge do caminho da release: ${agentEntry.name}@${versionEntry.name}`
        );
      }
      if (
        !manifest.output ||
        typeof manifest.output !== "object" ||
        manifest.output.file !== "business-knowledge.json" ||
        typeof manifest.output.sha256 !== "string" ||
        !sha256Pattern.test(manifest.output.sha256)
      ) {
        throw new Error(`Saída inválida no manifesto de ${agentEntry.name}@${versionEntry.name}`);
      }
      if (sha256(readFileSync(knowledgePath)) !== manifest.output.sha256) {
        throw new Error(`Checksum do conhecimento inválido em ${agentEntry.name}@${versionEntry.name}`);
      }

      for (const fileName of names) {
        const absolutePath = resolve(versionPath, fileName);
        files.set(repositoryPath(root, absolutePath), absolutePath);
      }
      agentReleaseCount += 1;
      releaseCount += 1;
    }
    if (agentReleaseCount === 0) {
      throw new Error(`Agente sem release versionada: ${agentEntry.name}`);
    }
  }
  if (releaseCount === 0) throw new Error("Nenhuma release versionada encontrada.");
  return { files, releaseCount };
}

function git(projectRoot, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding,
    maxBuffer: 20 * 1024 * 1024
  });
}

function releaseKey(path) {
  const parts = path.split("/");
  if (
    parts.length !== 5 ||
    parts[0] !== "config" ||
    parts[1] !== "releases" ||
    !agentPattern.test(parts[2]) ||
    !semverPattern.test(parts[3])
  ) {
    throw new Error(`Caminho de release inválido na base: ${path}`);
  }
  return parts.slice(0, 4).join("/");
}

/**
 * Rejeita alterações, remoções e novos arquivos dentro de versões que já existiam
 * no merge-base. Somente diretórios de versão inteiramente novos são permitidos.
 */
export function checkReleaseImmutability({
  projectRoot = process.cwd(),
  baseRef
} = {}) {
  const root = resolve(projectRoot);
  const current = validateReleaseStructure(root);
  if (!baseRef) return { ...current, baseCommit: null, newVersions: [] };

  let baseCommit;
  try {
    baseCommit = git(root, ["merge-base", "HEAD", baseRef]).trim();
  } catch (error) {
    throw new Error(`Não foi possível calcular o merge-base com ${baseRef}: ${error.message}`);
  }
  if (!/^[a-f0-9]{40,64}$/i.test(baseCommit)) {
    throw new Error(`Merge-base inválido para ${baseRef}.`);
  }

  const baseList = git(
    root,
    ["ls-tree", "-r", "--name-only", "-z", baseCommit, "--", "config/releases"],
    "buffer"
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const baseFiles = new Set(baseList);
  const baseVersions = new Set(baseList.map(releaseKey));

  for (const path of baseFiles) {
    const currentPath = current.files.get(path);
    if (!currentPath) throw new Error(`Release existente removida: ${path}`);
    const baseBytes = git(root, ["show", `${baseCommit}:${path}`], "buffer");
    if (!baseBytes.equals(readFileSync(currentPath))) {
      throw new Error(`Release existente alterada: ${path}`);
    }
  }

  const newVersions = new Set();
  for (const path of current.files.keys()) {
    const key = releaseKey(path);
    if (baseVersions.has(key) && !baseFiles.has(path)) {
      throw new Error(`Arquivo adicionado a uma release existente: ${path}`);
    }
    if (!baseVersions.has(key)) newVersions.add(key);
  }

  return {
    ...current,
    baseCommit,
    newVersions: [...newVersions].sort()
  };
}

function parseArgs(args) {
  let baseRef;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--base-ref") throw new Error(`Argumento desconhecido: ${args[index]}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--base-ref exige um valor.");
    baseRef = value;
    index += 1;
  }
  return { baseRef };
}

function main() {
  const result = checkReleaseImmutability(parseArgs(process.argv.slice(2)));
  process.stdout.write(
    `Releases íntegras: ${result.releaseCount}; ` +
      (result.baseCommit
        ? `${result.newVersions.length} nova(s) desde ${result.baseCommit.slice(0, 12)}.\n`
        : "estrutura validada sem comparação de base.\n")
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
