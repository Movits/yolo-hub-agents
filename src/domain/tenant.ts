export interface TenantContext {
  tenantId: string;
  agentId: string;
}

export const DEFAULT_TENANT_CONTEXT: Readonly<TenantContext> = Object.freeze({
  tenantId: "empresa-modelo",
  agentId: "empresa-modelo"
});

export function tenantScopeKey(tenant: TenantContext, ...parts: string[]): string {
  return JSON.stringify([tenant.tenantId, tenant.agentId, ...parts]);
}
