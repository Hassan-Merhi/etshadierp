import { AsyncLocalStorage } from "node:async_hooks";

export type TenantDatabaseScopeRuntimeContext = {
  kind: "tenant";
  companyId: number;
  authorizedCompanyIds: readonly number[];
};

export type MaintenanceDatabaseScopeRuntimeContext = {
  kind: "maintenance";
  reason: string;
};

export type DatabaseScopeRuntimeContext = TenantDatabaseScopeRuntimeContext | MaintenanceDatabaseScopeRuntimeContext;

const databaseScopeRuntime = new AsyncLocalStorage<DatabaseScopeRuntimeContext>();

function positiveCompanyId(value: unknown): number {
  const companyId = Number(value);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("database_tenant_scope_requires_positive_company_id");
  }
  return companyId;
}

export function createTenantDatabaseScope(
  companyIdValue: unknown,
  authorizedCompanyIdValues: readonly unknown[] = []
): TenantDatabaseScopeRuntimeContext {
  const companyId = positiveCompanyId(companyIdValue);
  const authorizedCompanyIds = [...new Set(authorizedCompanyIdValues.map(positiveCompanyId))]
    .filter((authorizedCompanyId) => authorizedCompanyId !== companyId)
    .sort((left, right) => left - right);

  return {
    kind: "tenant",
    companyId,
    authorizedCompanyIds,
  };
}

export function createMaintenanceDatabaseScope(reason: string): MaintenanceDatabaseScopeRuntimeContext {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error("database_maintenance_scope_requires_reason");
  }
  return { kind: "maintenance", reason: normalizedReason };
}

export function runWithDatabaseScopeRuntimeContext<T>(context: DatabaseScopeRuntimeContext, callback: () => T): T {
  return databaseScopeRuntime.run(context, callback);
}

export function runWithDatabaseMaintenanceScope<T>(reason: string, callback: () => T): T {
  const currentContext = databaseScopeRuntime.getStore();
  if (currentContext?.kind === "tenant") {
    throw new Error("database_tenant_maintenance_elevation_forbidden");
  }

  return runWithDatabaseScopeRuntimeContext(createMaintenanceDatabaseScope(reason), callback);
}

export function getDatabaseScopeRuntimeContext(): DatabaseScopeRuntimeContext | undefined {
  return databaseScopeRuntime.getStore();
}
