import { eq } from "drizzle-orm";
import {
  bankAccounts,
  containers,
  customers,
  employees,
  factoryContainers,
  fixedAssets,
  ledgerAccounts,
  locations,
  stockItems,
  vouchers,
} from "@shared/schema";
import type { CompanyIsolationLookupAdapter, CompanyScopedResourceType } from "./companyIsolationPolicy";
import type { DbTransaction } from "../../db";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

async function lookupCompany(
  tx: DbTransaction,
  table: PgTable,
  idColumn: PgColumn,
  companyColumn: PgColumn,
  resourceId: string | number
): Promise<number | null> {
  const numericId = typeof resourceId === "number" ? resourceId : Number(resourceId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

  const [row] = await tx.select({ companyId: companyColumn }).from(table).where(eq(idColumn, numericId)).limit(1);

  const companyId = row?.companyId;
  return typeof companyId === "number" ? companyId : null;
}

export function createDatabaseCompanyIsolationAdapter(): CompanyIsolationLookupAdapter {
  return {
    async loadResourceCompany({ tx, resourceType, resourceId }) {
      // The policy is storage-agnostic and declares its handle as unknown; this
      // adapter is the drizzle implementation of it.
      const database = tx as DbTransaction;

      const lookups: Partial<Record<CompanyScopedResourceType, { table: PgTable; idColumn: PgColumn; companyColumn: PgColumn }>> = {
        voucher: {
          table: vouchers,
          idColumn: vouchers.id,
          companyColumn: vouchers.companyId,
        },
        "ledger-account": {
          table: ledgerAccounts,
          idColumn: ledgerAccounts.id,
          companyColumn: ledgerAccounts.companyId,
        },
        "bank-account": {
          table: bankAccounts,
          idColumn: bankAccounts.id,
          companyColumn: bankAccounts.companyId,
        },
        customer: {
          table: customers,
          idColumn: customers.id,
          companyColumn: customers.companyId,
        },
        "stock-item": {
          table: stockItems,
          idColumn: stockItems.id,
          companyColumn: stockItems.companyId,
        },
        "stock-location": {
          table: locations,
          idColumn: locations.id,
          companyColumn: locations.companyId,
        },
        "factory-container": {
          table: factoryContainers,
          idColumn: factoryContainers.id,
          companyColumn: factoryContainers.companyId,
        },
        container: {
          table: containers,
          idColumn: containers.id,
          companyColumn: containers.companyId,
        },
        employee: {
          table: employees,
          idColumn: employees.id,
          companyColumn: employees.companyId,
        },
        "fixed-asset": {
          table: fixedAssets,
          idColumn: fixedAssets.id,
          companyColumn: fixedAssets.companyId,
        },
      };

      const lookup = lookups[resourceType];
      if (!lookup) return null;

      return lookupCompany(database, lookup.table, lookup.idColumn, lookup.companyColumn, resourceId);
    },
  };
}
