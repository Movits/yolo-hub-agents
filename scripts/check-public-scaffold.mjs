import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const forbiddenPatterns = [
  ["CPF", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ["CNPJ", /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/],
  ["telefone móvel brasileiro", /(?:\+?55\s*)?\(?\d{2}\)?\s*9\d{4}[-\s]?\d{4}\b/],
  [
    "e-mail fora dos domínios fictícios permitidos",
    /\b[A-Z0-9._%+-]+@(?![A-Z0-9.-]+\.(?:example|exemplo)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  ]
];

function trackedFiles(projectRoot) {
  return execFileSync("git", ["ls-files", "-z", "--", "brain", "config/releases"], {
    cwd: projectRoot,
    encoding: "utf8"
  })
    .split("\0")
    .filter(Boolean);
}

function scanContents(label, contents, errors) {
  for (const [patternLabel, pattern] of forbiddenPatterns) {
    if (pattern.test(contents)) errors.push(`${label}: possível dado real detectado (${patternLabel})`);
  }
}

export function checkPublicScaffold(projectRoot = process.cwd(), { history = false } = {}) {
  const root = resolve(projectRoot);
  const errors = [];
  const files = trackedFiles(root);
  for (const file of files) {
    const contents = readFileSync(resolve(root, file), "utf8");
    scanContents(file, contents, errors);
    if (file.endsWith("/business-knowledge.json")) {
      try {
        const knowledge = JSON.parse(contents);
        if (knowledge.prototype !== true) {
          errors.push(`${file}: release no scaffold público deve permanecer prototype=true`);
        }
      } catch (error) {
        errors.push(`${file}: JSON inválido: ${error.message}`);
      }
    }
  }
  if (history) {
    const historicalDiff = execFileSync(
      "git",
      [
        "log",
        "--all",
        "--full-history",
        "--no-color",
        "--format=",
        "-p",
        "--",
        "brain",
        "config/releases"
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    scanContents("histórico Git da brain/releases", historicalDiff, errors);
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return files.length;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const unknownArgs = process.argv.slice(2).filter((argument) => argument !== "--history");
    if (unknownArgs.length > 0) throw new Error(`Argumento desconhecido: ${unknownArgs[0]}`);
    const count = checkPublicScaffold(process.cwd(), { history: process.argv.includes("--history") });
    process.stdout.write(`Scaffold público verificado: ${count} arquivo(s), somente dados fictícios.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
