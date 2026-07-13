import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createRuntime } from "./runtime.js";

const runtime = createRuntime();
const terminal = createInterface({ input, output });
const userId = "cli-user";

output.write(`\n${runtime.knowledge.assistant.name} — simulador da ${runtime.knowledge.company.name}\n`);
output.write("Digite /reset para reiniciar, /estado para ver os registros ou /exit para sair.\n\n");

while (true) {
  const value = (await terminal.question("Você: ")).trim();
  if (!value) continue;
  if (value === "/exit") break;
  if (value === "/estado") {
    output.write(`${JSON.stringify(runtime.store.snapshot(runtime.tenantContext), null, 2)}\n\n`);
    continue;
  }

  const result = await runtime.agent.process({
    id: `cli-${randomUUID()}`,
    userId,
    text: value,
    timestamp: new Date(),
    source: "simulator",
    messageType: "text"
  });

  output.write(
    result.reply ? `${runtime.knowledge.assistant.name}: ${result.reply}\n\n` : "(automação pausada; sem resposta)\n\n"
  );
}

terminal.close();
