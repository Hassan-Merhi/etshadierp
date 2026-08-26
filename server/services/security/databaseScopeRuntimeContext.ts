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
    throw new Error("DATABASE_TENANT_SCOPE_REQUIRES_POSITIVE_COMPANY_ID");
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
    throw new Error("DATABASE_MAINTENANCE_SCOPE_REQUIRES_REASON");
  }
  return { kind: "maintenance", reason: normalizedReason };
}

export function runWithDatabaseScopeRuntimeContext<T>(context: DatabaseScopeRuntimeContext, callback: () => T): T {
  return databaseScopeRuntime.run(context, callback);
}

export function runWithDatabaseMaintenanceScope<T>(reason: string, callback: () => T): T {
  const currentContext = databaseScopeRuntime.getStore();
  if (currentContext?.kind === "tenant") {
    throw new Error("DATABASE_TENANT_SCOPE_MAINTENANCE_ELEVATION_FORBIDDEN");
  }

  return runWithDatabaseScopeRuntimeContext(createMaintenanceDatabaseScope(reason), callback);
}

export function getDatabaseScopeRuntimeContext(): DatabaseScopeRuntimeContext | undefined {
  return databaseScopeRuntime.getStore();
}
