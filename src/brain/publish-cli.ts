import { resolve } from "node:path";
import {
  compileBrain,
  defaultReleasesRoot,
  publishCompiledBrain
} from "./publisher.js";

interface CliOptions {
  agentId: string;
  asOf: string;
  releasesRoot: string;
  checkOnly: boolean;
  versionOverride?: string;
}

function takeValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} exige um valor.`);
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const projectRoot = process.cwd();
  let agentId = "";
  let asOf = new Date().toISOString().slice(0, 10);
  let releasesRoot = defaultReleasesRoot(projectRoot);
  let checkOnly = false;
  let versionOverride: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--agent") {
      agentId = takeValue(args, index, "--agent");
      index += 1;
    } else if (argument === "--as-of") {
      asOf = takeValue(args, index, "--as-of");
      index += 1;
    } else if (argument === "--out") {
      releasesRoot = resolve(takeValue(args, index, "--out"));
      index += 1;
    } else if (argument === "--version") {
      versionOverride = takeValue(args, index, "--version");
      index += 1;
    } else if (argument === "--check") {
      checkOnly = true;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  if (!agentId) throw new Error("Informe --agent <agent-id>.");
  return {
    agentId,
    asOf,
    releasesRoot,
    checkOnly,
    ...(versionOverride ? { versionOverride } : {})
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const compiled = await compileBrain({
    projectRoot: process.cwd(),
    agentId: options.agentId,
    asOf: options.asOf,
    ...(options.versionOverride ? { versionOverride: options.versionOverride } : {})
  });

  if (options.checkOnly) {
    process.stdout.write(
      `Brain compilada e avaliada: ${compiled.manifest.agentId}@${compiled.manifest.version}, ` +
        `${compiled.manifest.evals.passed} avaliação(ões) crítica(s).\n`
    );
    return;
  }

  const published = await publishCompiledBrain(options.releasesRoot, compiled);
  process.stdout.write(
    `${published.created ? "Release publicada" : "Release já existente e idêntica"}: ` +
      `${compiled.manifest.agentId}@${compiled.manifest.version}\n` +
      `Diretório: ${published.directory}\n` +
      `SHA-256 do manifesto: ${compiled.manifestSha256}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
