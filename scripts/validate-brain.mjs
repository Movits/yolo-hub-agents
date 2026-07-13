import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";

const projectRoot = process.cwd();
const brainRoot = resolve(projectRoot, "brain");
const errors = [];

const requiredFields = [
  "id",
  "agent",
  "type",
  "status",
  "owner",
  "sensitivity",
  "version",
  "effective_from",
  "expires_at",
  "source"
];

const allowedTypes = new Set([
  "company",
  "services",
  "faq",
  "policy",
  "support",
  "workflow",
  "eval",
  "governance",
  "glossary"
]);
const allowedStatuses = new Set(["draft", "in-review", "approved", "retired"]);
const allowedSensitivity = new Set([
  "public",
  "public-business",
  "internal"
]);

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /sk_(?:live|test)_[A-Za-z0-9]{20,}/,
  /EAA[A-Za-z0-9]{30,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /AC[a-f0-9]{32}/i,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /api\.render\.com\/deploy\/srv-[A-Za-z0-9_-]+\?key=[A-Za-z0-9_-]{10,}/i,
  /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{20,}/i
];

const rootTypeRules = {
  knowledgeRoots: new Set(["company", "services", "faq", "policy", "support", "glossary"]),
  workflowRoots: new Set(["workflow"]),
  evalRoots: new Set(["eval"])
};

const ignoredVaultDirectories = new Set([".obsidian", ".trash"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredVaultDirectories.has(entry.name) ? [] : walk(fullPath);
    }
    return [fullPath];
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSlug(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function toVaultPath(filePath) {
  return relative(brainRoot, filePath).split(sep).join("/");
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(filePath, contents) {
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    errors.push(`${toVaultPath(filePath)}: frontmatter ausente`);
    return null;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    errors.push(`${toVaultPath(filePath)}: frontmatter sem fechamento`);
    return null;
  }

  const metadata = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      errors.push(`${toVaultPath(filePath)}: linha de frontmatter não suportada: ${line}`);
      continue;
    }
    if (match[1] in metadata) {
      errors.push(`${toVaultPath(filePath)}: campo duplicado no frontmatter: ${match[1]}`);
    }
    metadata[match[1]] = unquote(match[2]);
  }
  return metadata;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

if (!existsSync(brainRoot)) {
  console.error("Brain ausente: crie a pasta brain/ antes de validar.");
  process.exit(1);
}

const allBrainEntries = walk(brainRoot);
const allBrainFiles = [];
for (const filePath of allBrainEntries) {
  const fileStats = lstatSync(filePath);
  if (fileStats.isSymbolicLink()) {
    errors.push(`${toVaultPath(filePath)}: links simbólicos não são permitidos na brain`);
    continue;
  }
  if (!fileStats.isFile()) {
    errors.push(`${toVaultPath(filePath)}: entrada não suportada na brain`);
    continue;
  }
  allBrainFiles.push(filePath);
}
const allowedExtensions = new Set([".md", ".json"]);
for (const filePath of allBrainFiles) {
  if (!allowedExtensions.has(extname(filePath).toLowerCase())) {
    errors.push(`${toVaultPath(filePath)}: tipo de arquivo não permitido na brain`);
  }
}

const textFiles = allBrainFiles.filter((filePath) =>
  allowedExtensions.has(extname(filePath).toLowerCase())
);
for (const filePath of textFiles) {
  const contents = readFileSync(filePath, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(contents)) errors.push(`${toVaultPath(filePath)}: padrão de segredo detectado`);
  }
}

const markdownFiles = allBrainFiles.filter((filePath) => extname(filePath).toLowerCase() === ".md");
const vaultFiles = new Set(allBrainFiles.map((filePath) => toVaultPath(filePath)));
const vaultTargets = new Set(
  markdownFiles.map((filePath) => toVaultPath(filePath).replace(/\.md$/i, ""))
);
const fileByVaultTarget = new Map(
  markdownFiles.map((filePath) => [toVaultPath(filePath).replace(/\.md$/i, ""), filePath])
);
const basenameTargets = new Map();
for (const target of vaultTargets) {
  const key = basename(target);
  const current = basenameTargets.get(key) ?? [];
  current.push(target);
  basenameTargets.set(key, current);
}

const ids = new Map();
const noteRecords = [];
let validatedNotes = 0;
let validatedLinks = 0;

for (const filePath of markdownFiles) {
  const vaultPath = toVaultPath(filePath);
  const contents = readFileSync(filePath, "utf8");

  const links = [...contents.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
  for (const link of links) {
    const [rawTarget = "", rawHeading] = link[1].trim().split("#", 2);
    const currentTarget = vaultPath.replace(/\.md$/i, "");
    const target = rawTarget.trim()
      ? rawTarget.trim().replace(/\\/g, "/").replace(/\.md$/i, "")
      : currentTarget;
    const fromDirectory = dirname(vaultPath).split(sep).join("/");
    const relativeTarget = normalize(join(fromDirectory, target)).split(sep).join("/");
    const basenameMatches = basenameTargets.get(target) ?? [];
    const resolvedTarget = vaultTargets.has(target)
      ? target
      : vaultTargets.has(relativeTarget)
        ? relativeTarget
        : basenameMatches.length === 1
          ? basenameMatches[0]
          : null;
    if (!resolvedTarget) {
      errors.push(`${vaultPath}: link Obsidian não resolvido: [[${link[1]}]]`);
    } else {
      validatedLinks += 1;
      const sourceParts = vaultPath.split("/");
      const targetParts = resolvedTarget.split("/");
      if (
        sourceParts[0] === "agents" &&
        targetParts[0] === "agents" &&
        sourceParts[1] !== targetParts[1]
      ) {
        errors.push(`${vaultPath}: link direto entre agentes não é permitido: [[${link[1]}]]`);
      }
      if (
        ["shared", "governance", "segments"].includes(sourceParts[0]) &&
        targetParts[0] === "agents"
      ) {
        errors.push(`${vaultPath}: conteúdo global não pode depender de um agente: [[${link[1]}]]`);
      }
      if (rawHeading) {
        const targetContents = readFileSync(fileByVaultTarget.get(resolvedTarget), "utf8");
        const headings = new Set(
          targetContents
            .split(/\r?\n/)
            .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1]?.trim().toLowerCase())
            .filter(Boolean)
        );
        if (!headings.has(rawHeading.trim().toLowerCase())) {
          errors.push(`${vaultPath}: heading Obsidian não encontrado: [[${link[1]}]]`);
        }
      }
    }
  }

  const markdownLinks = [...contents.matchAll(/(!?)\[[^\]]*\]\(([^)]+)\)/g)];
  for (const link of markdownLinks) {
    const isEmbed = link[1] === "!";
    const rawDestination = link[2].trim();
    const destinationMatch = rawDestination.match(
      /^(?:<([^>]+)>|(\S+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/
    );
    if (!destinationMatch) {
      errors.push(`${vaultPath}: destino de link Markdown não suportado: ${rawDestination}`);
      continue;
    }
    let destination = destinationMatch[1] ?? destinationMatch[2];
    const external = /^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith("//");
    if (external) {
      if (isEmbed) errors.push(`${vaultPath}: embed remoto não é permitido: ${destination}`);
      continue;
    }
    if (destination.startsWith("#")) {
      validatedLinks += 1;
      continue;
    }
    destination = destination.split("#", 1)[0].split("?", 1)[0];
    try {
      destination = decodeURIComponent(destination);
    } catch {
      errors.push(`${vaultPath}: URL inválida em link Markdown: ${rawDestination}`);
      continue;
    }
    if (destination.startsWith("/") || /^[A-Za-z]:[\\/]/.test(destination)) {
      errors.push(`${vaultPath}: link Markdown absoluto não é permitido: ${rawDestination}`);
      continue;
    }
    const fromDirectory = dirname(vaultPath).split(sep).join("/");
    const relativeTarget = normalize(join(fromDirectory, destination)).split(sep).join("/");
    const candidates = extname(relativeTarget)
      ? [relativeTarget]
      : [relativeTarget, `${relativeTarget}.md`];
    if (relativeTarget === ".." || relativeTarget.startsWith("../") || !candidates.some((target) => vaultFiles.has(target))) {
      errors.push(`${vaultPath}: link Markdown não resolvido: ${rawDestination}`);
    } else {
      validatedLinks += 1;
    }
  }

  const parts = vaultPath.split("/");
  const documentationFile =
    basename(vaultPath).toLowerCase() === "readme.md" ||
    basename(vaultPath).toLowerCase() === "home.md" ||
    parts.includes("_templates") ||
    parts.includes("_template");
  if (documentationFile) continue;

  const metadata = parseFrontmatter(filePath, contents);
  if (!metadata) continue;
  validatedNotes += 1;
  noteRecords.push({ metadata, vaultPath });

  for (const field of requiredFields) {
    if (
      !(field in metadata) ||
      typeof metadata[field] !== "string" ||
      metadata[field].trim() === ""
    ) {
      errors.push(`${vaultPath}: campo obrigatório ausente: ${field}`);
    }
  }

  if (!/^[a-z0-9][a-z0-9._-]+$/.test(metadata.id ?? "")) {
    errors.push(`${vaultPath}: id inválido: ${metadata.id ?? ""}`);
  } else if (ids.has(metadata.id)) {
    errors.push(`${vaultPath}: id duplicado com ${ids.get(metadata.id)}: ${metadata.id}`);
  } else {
    ids.set(metadata.id, vaultPath);
  }

  if (!allowedTypes.has(metadata.type)) errors.push(`${vaultPath}: type inválido: ${metadata.type}`);
  if (!allowedStatuses.has(metadata.status)) {
    errors.push(`${vaultPath}: status inválido: ${metadata.status}`);
  }
  if (!allowedSensitivity.has(metadata.sensitivity)) {
    errors.push(`${vaultPath}: sensitivity inválida: ${metadata.sensitivity}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version ?? "")) {
    errors.push(`${vaultPath}: version deve usar semver`);
  }
  if (!isIsoDate(metadata.effective_from)) {
    errors.push(`${vaultPath}: effective_from deve usar YYYY-MM-DD`);
  }
  if (metadata.expires_at !== "null" && !isIsoDate(metadata.expires_at)) {
    errors.push(`${vaultPath}: expires_at deve ser null ou YYYY-MM-DD`);
  }
  if (
    isIsoDate(metadata.effective_from) &&
    isIsoDate(metadata.expires_at) &&
    metadata.expires_at < metadata.effective_from
  ) {
    errors.push(`${vaultPath}: expires_at não pode ser anterior a effective_from`);
  }
  if (
    metadata.status === "approved" &&
    metadata.expires_at !== "null" &&
    isIsoDate(metadata.expires_at) &&
    metadata.expires_at < new Date().toISOString().slice(0, 10)
  ) {
    errors.push(`${vaultPath}: nota aprovada está expirada`);
  }
  if (metadata.status === "approved" && /\[TODO\]|\b(?:TBD|PREENCHER)\b|\{\{[^}]+\}\}/i.test(contents)) {
    errors.push(`${vaultPath}: nota aprovada contém placeholder`);
  }
  if (/^(?:config|src|tests)\//.test(metadata.source ?? "")) {
    const sourceRootName = metadata.source.split("/", 1)[0];
    const sourceRoot = resolve(projectRoot, sourceRootName);
    const sourcePath = resolve(projectRoot, metadata.source);
    const sourceExtension = extname(sourcePath).toLowerCase();
    const allowedSourceExtensions = {
      config: new Set([".json"]),
      src: new Set([".ts"]),
      tests: new Set([".ts"])
    };
    if (
      metadata.source.split("/").includes("..") ||
      !sourcePath.startsWith(`${sourceRoot}${sep}`) ||
      !allowedSourceExtensions[sourceRootName]?.has(sourceExtension) ||
      !existsSync(sourcePath) ||
      !lstatSync(sourcePath).isFile() ||
      lstatSync(sourcePath).isSymbolicLink()
    ) {
      errors.push(`${vaultPath}: source local não encontrado: ${metadata.source}`);
    }
  }

  if (parts[0] === "agents" && parts[1] && metadata.agent !== parts[1]) {
    errors.push(`${vaultPath}: agent deve ser ${parts[1]}`);
  }
  if (parts[0] === "shared" && metadata.agent !== "shared") {
    errors.push(`${vaultPath}: conteúdo compartilhado deve usar agent: shared`);
  }
}

const agentsRoot = resolve(brainRoot, "agents");
let validatedAgents = 0;
if (existsSync(agentsRoot)) {
  for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || (entry.name.startsWith("_") && entry.name !== "_template")) continue;
    const templateManifest = entry.name === "_template";
    const agentDirectory = join(agentsRoot, entry.name);
    const manifestPath = join(agentDirectory, "agent.json");
    if (!existsSync(manifestPath)) {
      errors.push(`agents/${entry.name}: agent.json ausente`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      errors.push(`agents/${entry.name}/agent.json: JSON inválido: ${error.message}`);
      continue;
    }
    if (!isPlainObject(manifest)) {
      errors.push(`agents/${entry.name}/agent.json: manifesto deve ser um objeto JSON`);
      continue;
    }
    if (!templateManifest) validatedAgents += 1;
    if (manifest.schemaVersion !== "1.0") {
      errors.push(`agents/${entry.name}: schemaVersion deve ser 1.0`);
    }
    if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      errors.push(`agents/${entry.name}: version do manifesto deve usar semver`);
    }
    const expectedManifestId = templateManifest ? "agent-id" : entry.name;
    if (manifest.id !== expectedManifestId) {
      errors.push(`agents/${entry.name}: id do manifesto não corresponde ao esperado`);
    }
    if (typeof manifest.displayName !== "string" || !manifest.displayName.trim()) {
      errors.push(`agents/${entry.name}: displayName ausente`);
    }
    if (!["draft", "prototype", "active", "retired"].includes(manifest.status)) {
      errors.push(`agents/${entry.name}: status do manifesto inválido`);
    }
    if (
      !Array.isArray(manifest.extends) ||
      !manifest.extends.includes("shared") ||
      manifest.extends.some((parent) => !isSlug(parent))
    ) {
      errors.push(`agents/${entry.name}: extends deve incluir shared`);
    } else {
      const segmentsRoot = resolve(brainRoot, "segments");
      for (const parent of manifest.extends) {
        if (parent === "shared") continue;
        const segmentPath = resolve(segmentsRoot, parent);
        if (
          !segmentPath.startsWith(`${segmentsRoot}${sep}`) ||
          !existsSync(segmentPath) ||
          !lstatSync(segmentPath).isDirectory() ||
          lstatSync(segmentPath).isSymbolicLink()
        ) {
          errors.push(`agents/${entry.name}: segmento herdado não encontrado: ${parent}`);
        }
      }
    }
    if (manifest.publishOnlyApproved !== true) {
      errors.push(`agents/${entry.name}: publishOnlyApproved deve ser true`);
    }
    if (
      !Array.isArray(manifest.publishSensitivity) ||
      manifest.publishSensitivity.length === 0 ||
      manifest.publishSensitivity.some((value) => !["public", "public-business"].includes(value))
    ) {
      errors.push(`agents/${entry.name}: publishSensitivity deve limitar conteúdo público`);
    }
    const contentRoots = [];
    const declaredRootNames = new Map();
    for (const field of ["knowledgeRoots", "workflowRoots", "evalRoots"]) {
      if (
        !Array.isArray(manifest[field]) ||
        manifest[field].length === 0 ||
        manifest[field].some((root) => !isSlug(root))
      ) {
        errors.push(`agents/${entry.name}: ${field} deve ser uma lista não vazia`);
        continue;
      }
      for (const root of manifest[field]) {
        if (declaredRootNames.has(root)) {
          errors.push(
            `agents/${entry.name}: raiz ${root} repetida em ${declaredRootNames.get(root)} e ${field}`
          );
        } else {
          declaredRootNames.set(root, field);
        }
        const rootPath = resolve(agentDirectory, root);
        if (
          !rootPath.startsWith(`${agentDirectory}${sep}`) ||
          !existsSync(rootPath) ||
          !lstatSync(rootPath).isDirectory() ||
          lstatSync(rootPath).isSymbolicLink()
        ) {
          errors.push(`agents/${entry.name}: raiz inválida em ${field}: ${root}`);
        } else {
          contentRoots.push({ field, prefix: `agents/${entry.name}/${root}/`, root });
        }
      }
    }
    if (manifest.runtimeConfig !== undefined && typeof manifest.runtimeConfig !== "string") {
      errors.push(`agents/${entry.name}: runtimeConfig deve ser uma string`);
    } else if (manifest.runtimeConfig) {
      const runtimeConfig = resolve(agentDirectory, manifest.runtimeConfig);
      const configRoot = resolve(projectRoot, "config");
      if (
        !runtimeConfig.startsWith(`${configRoot}${sep}`) ||
        !existsSync(runtimeConfig) ||
        extname(runtimeConfig).toLowerCase() !== ".json" ||
        !lstatSync(runtimeConfig).isFile() ||
        lstatSync(runtimeConfig).isSymbolicLink()
      ) {
        errors.push(`agents/${entry.name}: runtimeConfig deve ser um JSON regular dentro de config/`);
      } else {
        try {
          const realConfigRoot = realpathSync(configRoot);
          const realRuntimeConfig = realpathSync(runtimeConfig);
          if (!realRuntimeConfig.startsWith(`${realConfigRoot}${sep}`)) {
            errors.push(`agents/${entry.name}: runtimeConfig resolve para fora de config/`);
            continue;
          }
          const runtimeData = JSON.parse(readFileSync(runtimeConfig, "utf8"));
          const validRuntimeShape =
            isPlainObject(runtimeData) &&
            runtimeData.agentId === entry.name &&
            isPlainObject(runtimeData.assistant) &&
            typeof runtimeData.assistant.name === "string" &&
            runtimeData.assistant.name.trim() !== "" &&
            isPlainObject(runtimeData.company) &&
            typeof runtimeData.company.name === "string" &&
            runtimeData.company.name.trim() !== "" &&
            isPlainObject(runtimeData.policies) &&
            Array.isArray(runtimeData.services) &&
            runtimeData.services.length > 0 &&
            Array.isArray(runtimeData.faqs) &&
            Array.isArray(runtimeData.supportProcedures);
          if (!validRuntimeShape) {
            errors.push(
              `agents/${entry.name}: runtimeConfig não segue o schema empresarial básico ou pertence a outro agente`
            );
          }
        } catch (error) {
          errors.push(`agents/${entry.name}: runtimeConfig contém JSON inválido: ${error.message}`);
        }
      }
    }
    if (!templateManifest) {
      for (const note of noteRecords.filter(
        ({ metadata, vaultPath }) =>
          metadata.agent === entry.name && vaultPath.startsWith(`agents/${entry.name}/`)
      )) {
        const matchingRoots = contentRoots.filter(({ prefix }) => note.vaultPath.startsWith(prefix));
        if (matchingRoots.length === 0) {
          errors.push(`${note.vaultPath}: nota fora das raízes declaradas no manifesto`);
          continue;
        }
        for (const { field } of matchingRoots) {
          if (!rootTypeRules[field].has(note.metadata.type)) {
            errors.push(`${note.vaultPath}: type ${note.metadata.type} incompatível com ${field}`);
          }
        }
      }
    }
    const approvedInRoots = noteRecords.some(
      ({ metadata, vaultPath }) =>
        metadata.agent === entry.name &&
        metadata.status === "approved" &&
        contentRoots.some(({ prefix }) => vaultPath.startsWith(prefix))
    );
    if (!templateManifest && !approvedInRoots) {
      errors.push(`agents/${entry.name}: nenhum conteúdo approved encontrado`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Brain inválida (${errors.length} erro(s)):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Brain válida: ${validatedNotes} notas, ${validatedAgents} agente(s), ${validatedLinks} link(s) Obsidian.`
);
