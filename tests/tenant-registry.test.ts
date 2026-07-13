import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import {
  createTenantRegistry,
  loadTenantRegistry,
  type TenantRegistryConfig
} from "../src/tenancy/registry.js";

const releasesRoot = resolve("config/releases");
const releaseVersion = "1.0.0";
const manifestSha256 = "88ac89ba12849303d140fc9a667de1d5d7a21d511253d3a345d953ddc275abd0";

function registration(
  tenantId: string,
  simulatorKeyId: string,
  wabaId?: string,
  phoneNumberId?: string
): TenantRegistryConfig["tenants"][number] {
  return {
    active: true,
    tenantId,
    agentId: "empresa-modelo",
    release: { version: releaseVersion, manifestSha256 },
    simulator: { keyId: simulatorKeyId },
    ...(wabaId && phoneNumberId
      ? { whatsapp: { enabled: false as const, wabaId, phoneNumberId } }
      : {})
  };
}

function config(
  ...tenants: TenantRegistryConfig["tenants"]
): TenantRegistryConfig {
  return { schemaVersion: 1, tenants };
}

describe("TenantRegistry", () => {
  it("carrega o exemplo público e resolve índices sem armazenar segredos", async () => {
    const registry = loadTenantRegistry(resolve("config/tenants.example.json"), {
      releasesRoot,
      store: new MemoryStore()
    });

    const tenant = registry.byTenantId("empresa-modelo");
    expect(tenant).toBeDefined();
    expect(tenant?.context).toEqual({ tenantId: "empresa-modelo", agentId: "empresa-modelo" });
    expect(tenant?.release.identity).toMatchObject({
      agentId: "empresa-modelo",
      version: releaseVersion,
      manifestSha256
    });
    expect(registry.bySimulatorKeyId("empresa-modelo-demo")).toBe(tenant);
    expect(registry.byWhatsAppBinding("000000000000000", "000000000000000")).toBe(tenant);
    expect(registry.byWhatsAppBinding("000000000000000", "outro-numero")).toBeUndefined();

    const source = await readFile(resolve("config/tenants.example.json"), "utf8");
    expect(source).not.toMatch(/token|secret|password|authorization/i);
  });

  it("cria um agente por tenant e preserva sessão e deduplicação com IDs iguais", async () => {
    const registry = createTenantRegistry(
      config(
        registration("tenant-a", "simulator-a", "waba-a", "phone-a"),
        registration("tenant-b", "simulator-b", "waba-b", "phone-b")
      ),
      { releasesRoot, store: new MemoryStore() }
    );
    const tenantA = registry.byTenantId("tenant-a")!;
    const tenantB = registry.byTenantId("tenant-b")!;

    const optOut = await tenantA.agent.process({
      id: "same-message-id",
      userId: "same-user",
      text: "STOP",
      timestamp: new Date(),
      source: "simulator",
      messageType: "text"
    });
    const otherTenant = await tenantB.agent.process({
      id: "same-message-id",
      userId: "same-user",
      text: "Oi",
      timestamp: new Date(),
      source: "simulator",
      messageType: "text"
    });

    expect(optOut.intent).toBe("opt_out");
    expect(otherTenant.duplicate).not.toBe(true);
    expect(otherTenant.suppressed).not.toBe(true);
    expect(otherTenant.reply).toBeTruthy();
    expect(registry.bySimulatorKeyId("simulator-a")).toBe(tenantA);
    expect(registry.byWhatsAppBinding("waba-b", "phone-b")).toBe(tenantB);
    expect(registry.list()).toHaveLength(2);
  });

  it.each([
    {
      label: "tenantId",
      tenants: [registration("tenant-a", "key-a"), registration("tenant-a", "key-b")],
      error: "tenantId duplicado"
    },
    {
      label: "simulator.keyId",
      tenants: [registration("tenant-a", "same-key"), registration("tenant-b", "same-key")],
      error: "simulator.keyId duplicado"
    },
    {
      label: "binding WhatsApp",
      tenants: [
        registration("tenant-a", "key-a", "same-waba", "same-phone"),
        registration("tenant-b", "key-b", "same-waba", "same-phone")
      ],
      error: "Binding WhatsApp duplicado"
    }
  ])("falha antes de carregar releases quando $label é duplicado", ({ tenants, error }) => {
    expect(() =>
      createTenantRegistry(config(...tenants), {
        releasesRoot,
        store: new MemoryStore()
      })
    ).toThrow(error);
  });

  it("usa schema estrito, proíbe credenciais e não contém tokens de conectores", () => {
    const base = registration("tenant-a", "key-a", "waba-a", "phone-a");

    expect(() =>
      createTenantRegistry(
        {
          schemaVersion: 1,
          tenants: [
            {
              ...base,
              simulator: { keyId: "key-a", token: "não-pode-ficar-no-registro" }
            }
          ]
        },
        { releasesRoot, store: new MemoryStore() }
      )
    ).toThrow();

    const enabled = createTenantRegistry(
      {
        schemaVersion: 1,
        tenants: [
          {
            ...base,
            whatsapp: { enabled: true, wabaId: "waba-a", phoneNumberId: "phone-a" }
          }
        ]
      },
      { releasesRoot, store: new MemoryStore() }
    );
    expect(enabled.byWhatsAppBinding("waba-a", "phone-a")?.registration.whatsapp?.enabled).toBe(
      true
    );
  });

  it("falha fechado quando a release selecionada pertence a outro agentId", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "tenant-registry-"));
    const copiedRoot = resolve(directory, "releases");
    await cp(
      resolve(releasesRoot, "empresa-modelo", releaseVersion),
      resolve(copiedRoot, "outro-agente", releaseVersion),
      { recursive: true }
    );

    expect(() =>
      createTenantRegistry(
        {
          schemaVersion: 1,
          tenants: [
            {
              ...registration("tenant-a", "key-a"),
              agentId: "outro-agente"
            }
          ]
        },
        { releasesRoot: copiedRoot, store: new MemoryStore() }
      )
    ).toThrow("Manifesto diverge do agente");
  });

  it("rejeita checksum de release incorreto e JSON de registro inválido", async () => {
    expect(() =>
      createTenantRegistry(
        config({
          ...registration("tenant-a", "key-a"),
          release: { version: releaseVersion, manifestSha256: "0".repeat(64) }
        }),
        { releasesRoot, store: new MemoryStore() }
      )
    ).toThrow("não corresponde ao SHA-256 fixado");

    const directory = await mkdtemp(resolve(tmpdir(), "tenant-registry-json-"));
    const path = resolve(directory, "tenants.json");
    await writeFile(path, "{invalid", "utf8");
    expect(() =>
      loadTenantRegistry(path, { releasesRoot, store: new MemoryStore() })
    ).toThrow("JSON inválido");
  });
});
