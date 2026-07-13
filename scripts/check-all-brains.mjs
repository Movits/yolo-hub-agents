import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const agentPattern = /^[a-z0-9][a-z0-9-]*$/;

export function discoverAgentIds(projectRoot = process.cwd()) {
  const agentsRoot = resolve(projectRoot, "brain", "agents");
  if (!existsSync(agentsRoot)) throw new Error(`Diretório de agentes não encontrado: ${agentsRoot}`);
  const rootStats = lstatSync(agentsRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Diretório de agentes inválido: ${agentsRoot}`);
  }

  const agentIds = [];
  for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (entry.name === "_template") continue;
    if (entry.isSymbolicLink() || !entry.isDirectory() || !agentPattern.test(entry.name)) {
      throw new Error(`Entrada inválida em brain/agents: ${entry.name}`);
    }
    const manifestPath = resolve(agentsRoot, entry.name, "agent.json");
    if (!existsSync(manifestPath)) throw new Error(`Agente sem agent.json: ${entry.name}`);
    const manifestStats = lstatSync(manifestPath);
    if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
      throw new Error(`Manifesto de agente inválido: ${entry.name}/agent.json`);
    }
    agentIds.push(entry.name);
  }
  agentIds.sort((left, right) => left.localeCompare(right, "en"));
  if (agentIds.length === 0) throw new Error("Nenhum agente publicável encontrado.");
  return agentIds;
}

function runValidator(projectRoot) {
  execFileSync(process.execPath, [resolve(projectRoot, "scripts", "validate-brain.mjs")], {
    cwd: projectRoot,
    stdio: "inherit"
  });
}

function runPnpm(projectRoot, args) {
  const pnpmEntrypoint = process.env.npm_execpath;
  if (pnpmEntrypoint && existsSync(pnpmEntrypoint)) {
    execFileSync(process.execPath, [pnpmEntrypoint, ...args], {
      cwd: projectRoot,
      stdio: "inherit"
    });
    return;
  }
  const corepackEntrypoint = resolve(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js"
  );
  if (existsSync(corepackEntrypoint)) {
    execFileSync(process.execPath, [corepackEntrypoint, "pnpm", ...args], {
      cwd: projectRoot,
      stdio: "inherit"
    });
    return;
  }
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: projectRoot,
    stdio: "inherit"
  });
}

function runPublisher(projectRoot, agentId) {
  runPnpm(projectRoot, ["brain:publish", "--agent", agentId, "--check"]);
}

export function checkAllBrains({
  projectRoot = process.cwd(),
  validate = runValidator,
  checkAgent = runPublisher
} = {}) {
  const root = resolve(projectRoot);
  const agentIds = discoverAgentIds(root);
  validate(root);
  for (const agentId of agentIds) checkAgent(root, agentId);
  return agentIds;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) throw new Error(`Argumento desconhecido: ${args[0]}`);
  const agentIds = checkAllBrains();
  process.stdout.write(`Brains e releases verificadas: ${agentIds.join(", ")}\n`);
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
