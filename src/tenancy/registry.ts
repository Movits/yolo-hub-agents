import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { BusinessAgent } from "../application/agent.js";
import type { LlmResponder, SessionStore } from "../application/ports.js";
import {
  loadPinnedKnowledgeRelease,
  type KnowledgeRelease
} from "../config/release.js";
import type { TrustedReleaseKeys } from "../brain/release-signature.js";
import type { TenantContext } from "../domain/tenant.js";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const providerIdPattern = /^[A-Za-z0-9_-]{1,100}$/;
const maximumRegistryBytes = 1024 * 1024;

const releaseSelectionSchema = z
  .object({
    version: z.string().regex(semverPattern),
    manifestSha256: z.string().regex(sha256Pattern)
  })
  .strict();

const simulatorBindingSchema = z
  .object({
    keyId: z.string().regex(slugPattern)
  })
  .strict();

const whatsappBindingSchema = z
  .object({
    enabled: z.boolean(),
    wabaId: z.string().regex(providerIdPattern),
    phoneNumberId: z.string().regex(providerIdPattern)
  })
  .strict();

export const tenantRegistrationSchema = z
  .object({
    active: z.literal(true),
    tenantId: z.string().regex(slugPattern),
    agentId: z.string().regex(slugPattern),
    release: releaseSelectionSchema,
    simulator: simulatorBindingSchema,
    whatsapp: whatsappBindingSchema.optional()
  })
  .strict();

export const tenantRegistryConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenants: z.array(tenantRegistrationSchema).min(1).max(1_000)
  })
  .strict();

export type TenantRegistration = z.infer<typeof tenantRegistrationSchema>;
export type TenantRegistryConfig = z.infer<typeof tenantRegistryConfigSchema>;

export interface TenantRuntime {
  readonly registration: TenantRegistration;
  readonly context: TenantContext;
  readonly release: KnowledgeRelease;
  readonly agent: BusinessAgent;
}

export interface TenantRegistryOptions {
  releasesRoot: string;
  store: SessionStore;
  llm?: LlmResponder;
  requireReleaseSignature?: boolean;
  trustedPublicKeys?: TrustedReleaseKeys;
}

function whatsappBindingKey(wabaId: string, phoneNumberId: string): string {
  return JSON.stringify([wabaId, phoneNumberId]);
}

function assertUniqueRegistrations(config: TenantRegistryConfig): void {
  const tenantIds = new Set<string>();
  const simulatorKeyIds = new Set<string>();
  const whatsappBindings = new Set<string>();

  for (const registration of config.tenants) {
    if (tenantIds.has(registration.tenantId)) {
      throw new Error(`tenantId duplicado no registro: ${registration.tenantId}`);
    }
    tenantIds.add(registration.tenantId);

    if (simulatorKeyIds.has(registration.simulator.keyId)) {
      throw new Error(`simulator.keyId duplicado no registro: ${registration.simulator.keyId}`);
    }
    simulatorKeyIds.add(registration.simulator.keyId);

    if (registration.whatsapp) {
      const bindingKey = whatsappBindingKey(
        registration.whatsapp.wabaId,
        registration.whatsapp.phoneNumberId
      );
      if (whatsappBindings.has(bindingKey)) {
        throw new Error(
          `Binding WhatsApp duplicado no registro: ${registration.whatsapp.wabaId}/${registration.whatsapp.phoneNumberId}`
        );
      }
      whatsappBindings.add(bindingKey);
    }
  }
}

function immutableRegistration(registration: TenantRegistration): TenantRegistration {
  const release = Object.freeze({ ...registration.release });
  const simulator = Object.freeze({ ...registration.simulator });
  const whatsapp = registration.whatsapp
    ? Object.freeze({ ...registration.whatsapp })
    : undefined;
  return Object.freeze({
    ...registration,
    release,
    simulator,
    ...(whatsapp ? { whatsapp } : {})
  });
}

export class TenantRegistry {
  private readonly tenantsById = new Map<string, TenantRuntime>();
  private readonly tenantsBySimulatorKeyId = new Map<string, TenantRuntime>();
  private readonly tenantsByWhatsAppBinding = new Map<string, TenantRuntime>();

  constructor(configInput: unknown, options: TenantRegistryOptions) {
    const config = tenantRegistryConfigSchema.parse(configInput);
    assertUniqueRegistrations(config);

    for (const parsedRegistration of config.tenants) {
      const registration = immutableRegistration(parsedRegistration);
      const release = loadPinnedKnowledgeRelease({
        releasesRoot: options.releasesRoot,
        agentId: registration.agentId,
        version: registration.release.version,
        expectedManifestSha256: registration.release.manifestSha256,
        requireSignature: options.requireReleaseSignature ?? false,
        trustedPublicKeys: options.trustedPublicKeys ?? {}
      });
      if (
        release.identity.agentId !== registration.agentId ||
        release.knowledge.agentId !== registration.agentId
      ) {
        throw new Error(
          `Release de ${registration.tenantId} diverge do agentId ${registration.agentId}.`
        );
      }

      const context: TenantContext = Object.freeze({
        tenantId: registration.tenantId,
        agentId: registration.agentId
      });
      const runtime: TenantRuntime = Object.freeze({
        registration,
        context,
        release,
        agent: new BusinessAgent(context, release, options.store, options.llm)
      });

      this.tenantsById.set(registration.tenantId, runtime);
      this.tenantsBySimulatorKeyId.set(registration.simulator.keyId, runtime);
      if (registration.whatsapp) {
        this.tenantsByWhatsAppBinding.set(
          whatsappBindingKey(
            registration.whatsapp.wabaId,
            registration.whatsapp.phoneNumberId
          ),
          runtime
        );
      }
    }
  }

  byTenantId(tenantId: string): TenantRuntime | undefined {
    return this.tenantsById.get(tenantId);
  }

  bySimulatorKeyId(keyId: string): TenantRuntime | undefined {
    return this.tenantsBySimulatorKeyId.get(keyId);
  }

  byWhatsAppBinding(wabaId: string, phoneNumberId: string): TenantRuntime | undefined {
    return this.tenantsByWhatsAppBinding.get(whatsappBindingKey(wabaId, phoneNumberId));
  }

  list(): readonly TenantRuntime[] {
    return Object.freeze([...this.tenantsById.values()]);
  }
}

export function createTenantRegistry(
  configInput: unknown,
  options: TenantRegistryOptions
): TenantRegistry {
  return new TenantRegistry(configInput, options);
}

export function loadTenantRegistry(
  configPath: string,
  options: TenantRegistryOptions
): TenantRegistry {
  const path = resolve(configPath);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) throw new Error(`Symlink não permitido no registro de tenants: ${path}`);
  if (!stats.isFile()) throw new Error(`Arquivo regular esperado para o registro de tenants: ${path}`);
  if (stats.size > maximumRegistryBytes) {
    throw new Error(`Registro de tenants excede o limite de ${maximumRegistryBytes} bytes.`);
  }

  let input: unknown;
  try {
    input = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Registro de tenants contém JSON inválido: ${(error as Error).message}`);
  }
  return createTenantRegistry(input, options);
}
