import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const projectRoot = process.cwd();
const checkHistory = process.argv.includes("--history");
const errors = [];

const patterns = [
  ["chave OpenAI/Anthropic", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["token GitHub fine-grained", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["token GitHub clássico", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["token Meta", /\bEAA[A-Za-z0-9]{30,}\b/],
  ["access key AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["chave Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["token Slack", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["chave Stripe", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ["conta Twilio", /\bAC[a-f0-9]{32}\b/i],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["chave privada", /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  [
    "deploy hook Render",
    /api\.render\.com\/deploy\/srv-[A-Za-z0-9_-]+\?key=[A-Za-z0-9_-]{10,}/i
  ],
  ["Bearer token literal", /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{20,}/i]
];

const binaryExtensions = new Set([
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip"
]);

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
}

function scan(label, contents) {
  for (const [name, pattern] of patterns) {
    if (pattern.test(contents)) errors.push(`${label}: padrão detectado: ${name}`);
  }
}

function isSensitivePath(path) {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)\.env(?:\.|$)/.test(normalized)) {
    return !/\.env\.(?:example|sample|template)$/.test(normalized);
  }
  return (
    /(^|\/)(?:\.npmrc|\.netrc|\.git-credentials|\.htpasswd)$/.test(normalized) ||
    /(^|\/)(?:\.aws|\.kube|secrets?|\.secrets)(\/|$)/.test(normalized) ||
    /(?:^|\/)(?:credentials|service-account)[^/]*\.json$/.test(normalized) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|tfvars|tfvars\.json)$/.test(normalized) ||
    normalized === "config/company.json" ||
    /^config\/.*\.local\.json$/.test(normalized)
  );
}

const trackedFiles = git(["ls-files", "-z"])
  .split("\0")
  .filter(Boolean);

for (const file of trackedFiles) {
  if (isSensitivePath(file)) {
    errors.push(`${file}: caminho sensível não pode ser rastreado`);
    continue;
  }
  if (file === "scripts/check-repository-secrets.mjs") continue;
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;
  const contents = readFileSync(resolve(projectRoot, file));
  if (contents.includes(0)) continue;
  scan(file, contents.toString("utf8"));
}

if (checkHistory) {
  const history = git(["log", "--all", "--full-history", "--no-color", "-p"]);
  scan("histórico Git", history);

  const historicalPaths = git(["rev-list", "--objects", "--all"])
    .split(/\r?\n/)
    .map((line) => line.slice(line.indexOf(" ") + 1))
    .filter((path) => path && isSensitivePath(path));
  for (const path of historicalPaths) {
    errors.push(`histórico Git: caminho sensível rastreado: ${path}`);
  }
}

if (errors.length > 0) {
  console.error(`Verificação de segredos falhou (${errors.length} ocorrência(s)):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Segredos verificados: ${trackedFiles.length} arquivo(s) rastreado(s)${checkHistory ? " e histórico Git" : ""}.`
);
