import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import {
  bankAccounts,
  customerOrders,
  customerProformas,
  customers,
  employees,
  factoryBaleProducts,
  factoryBales,
  factoryCategories,
  factoryContainers,
  factoryMixBatches,
  factoryRawMaterialAdjustments,
  factoryRawStock,
  ledgerAccounts,
  locations,
  stockGroups,
  stockItems,
  suppliers,
  vouchers,
} from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  classifyDeletedItemScope,
  type DeletedItemScopeType,
} from "../services/security/deletedItemScopePolicy";

async function loadCompanyId(type: DeletedItemScopeType, id: number): Promise<number | null> {
  const mappings: Partial<
    Record<DeletedItemScopeType, { table: any; idColumn: any; companyColumn: any }>
  > = {
    location: { table: locations, idColumn: locations.id, companyColumn: locations.companyId },
    stockItem: { table: stockItems, idColumn: stockItems.id, companyColumn: stockItems.companyId },
    stockGroup: { table: stockGroups, idColumn: stockGroups.id, companyColumn: stockGroups.companyId },
    ledgerAccount: {
      table: ledgerAccounts,
      idColumn: ledgerAccounts.id,
      companyColumn: ledgerAccounts.companyId,
    },
    employee: { table: employees, idColumn: employees.id, companyColumn: employees.companyId },
    customer: { table: customers, idColumn: customers.id, companyColumn: customers.companyId },
    bankAccount: {
      table: bankAccounts,
      idColumn: bankAccounts.id,
      companyColumn: bankAccounts.companyId,
    },
    voucher: { table: vouchers, idColumn: vouchers.id, companyColumn: vouchers.companyId },
    orphanedPosSale: { table: vouchers, idColumn: vouchers.id, companyColumn: vouchers.companyId },
    factoryCategory: {
      table: factoryCategories,
      idColumn: factoryCategories.id,
      companyColumn: factoryCategories.companyId,
    },
    factoryBaleProduct: {
      table: factoryBaleProducts,
      idColumn: factoryBaleProducts.id,
      companyColumn: factoryBaleProducts.companyId,
    },
    factoryContainer: {
      table: factoryContainers,
      idColumn: factoryContainers.id,
      companyColumn: factoryContainers.companyId,
    },
    factoryRawStock: {
      table: factoryRawStock,
      idColumn: factoryRawStock.id,
      companyColumn: factoryRawStock.companyId,
    },
    factoryRawMaterialAdjustment: {
      table: factoryRawMaterialAdjustments,
      idColumn: factoryRawMaterialAdjustments.id,
      companyColumn: factoryRawMaterialAdjustments.companyId,
    },
    factoryMixBatch: {
      table: factoryMixBatches,
      idColumn: factoryMixBatches.id,
      companyColumn: factoryMixBatches.companyId,
    },
    factoryBale: {
      table: factoryBales,
      idColumn: factoryBales.id,
      companyColumn: factoryBales.companyId,
    },
    customerProforma: {
      table: customerProformas,
      idColumn: customerProformas.id,
      companyColumn: customerProformas.companyId,
    },
    customerOrder: {
      table: customerOrders,
      idColumn: customerOrders.id,
      companyColumn: customerOrders.companyId,
    },
  };

  const mapping = mappings[type];
  if (!mapping) return null;

  const [row] = await db
    .select({ companyId: mapping.companyColumn })
    .from(mapping.table)
    .where(eq(mapping.idColumn, id))
    .limit(1);
  return row?.companyId ?? null;
}

function deny(
  req: Request,
  res: Response,
  reason: string,
  status: number,
  message: string
): false {
  logger.error(
    JSON.stringify({
      event: "deleted_item_scope_denied",
      ts: new Date().toISOString(),
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role: req.session.currentRole ?? null,
      companyId: req.session.currentCompanyId ?? null,
      method: req.method,
      path: req.path,
      reason,
    })
  );
  res.status(status).json({ message });
  return false;
}

export async function enforceDeletedItemCompanyScope(
  req: Request,
  res: Response
): Promise<boolean> {
  const match = classifyDeletedItemScope(req.path);
  if (!match) return true;

  const companyId = Number(req.session.currentCompanyId);
  const role = req.session.currentRole;
  if (!req.session.userId || !role || !Number.isSafeInteger(companyId) || companyId <= 0) {
    return true;
  }

  if (match.globalMaintenance) {
    if (role !== "Developer") {
      return deny(
        req,
        res,
        "GLOBAL_SUPPLIER_MAINTENANCE_REQUIRES_DEVELOPER",
        403,
        "Developer access required for global supplier maintenance"
      );
    }

    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, match.id))
      .limit(1);
    if (!supplier) return deny(req, res, "DELETED_ITEM_NOT_FOUND", 404, "Item not found");
    return true;
  }

  const recordCompanyId = await loadCompanyId(match.type, match.id);
  if (recordCompanyId == null || recordCompanyId !== companyId) {
    return deny(req, res, "DELETED_ITEM_COMPANY_MISMATCH", 404, "Item not found");
  }

  return true;
}
