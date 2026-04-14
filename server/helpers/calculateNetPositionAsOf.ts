/**
 * Shared helper: calculate the ERP net position as of a specific date.
 *
 * Matches the logic of /api/stats/net-profit exactly:
 *   - ledger account classification via classifyNetPositionAccounts()
 *   - historical stock on floor via calculateHistoricalLocationInventory()
 *   - employee advance/liability from voucher entries
 *   - supplier balances (parent company only)
 *   - stock OTW: containers with importDate ≤ toDate and offloadDate > toDate
 *
 * Returns the four values the caller needs to build a monthly snapshot.
 */

import { db } from "../db";
import { storage } from "../storage";
import {
  vouchers, voucherEntries, locations, employees, suppliers, containers,
} from "@shared/schema";
import { eq, and, or, isNull, lte, sql } from "drizzle-orm";
import { classifyNetPositionAccounts, round2 } from "../netPositionHelper";
import { calculateHistoricalLocationInventory } from "../routes/_helpers";

export interface NetPositionSnapshot {
  forUsTotal: number;
  onUsTotal: number;
  netPosition: number;
  netPositionLabel: string;
}

export async function calculateNetPositionAsOf(
  companyId: number,
  toDate: string, // YYYY-MM-DD
): Promise<NetPositionSnapshot> {
  // All ledger accounts (including hidden — same as dashboard)
  const companyAccounts = await storage.getAllLedgerAccounts(companyId, true);

  // Fetch all voucher entries up to toDate — balance-sheet is cumulative
  const companyEntries = await db
    .select({
      ledgerAccountId: voucherEntries.ledgerAccountId,
      supplierId:      voucherEntries.supplierId,
      employeeId:      voucherEntries.employeeId,
      debitAmount:     voucherEntries.debitAmount,
      creditAmount:    voucherEntries.creditAmount,
    })
    .from(voucherEntries)
    .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
    .where(and(
      eq(vouchers.companyId, companyId),
      eq(vouchers.optional, false),
      isNull(vouchers.deletedAt),
      lte(vouchers.voucherDate, toDate),
    ))
    .execute();

  // Build balance maps (identical structure to statsRoutes.ts)
  const accountBalances  = new Map<number, { debit: number; credit: number }>();
  const supplierBalances = new Map<number, { debit: number; credit: number }>();
  const employeeBalances = new Map<number, { debit: number; credit: number }>();

  for (const e of companyEntries) {
    const d = parseFloat(e.debitAmount  || "0");
    const c = parseFloat(e.creditAmount || "0");
    if (e.ledgerAccountId) {
      const cur = accountBalances.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
      accountBalances.set(e.ledgerAccountId, { debit: cur.debit + d, credit: cur.credit + c });
    }
    if (e.supplierId) {
      const cur = supplierBalances.get(e.supplierId) || { debit: 0, credit: 0 };
      supplierBalances.set(e.supplierId, { debit: cur.debit + d, credit: cur.credit + c });
    }
    if (e.employeeId) {
      const cur = employeeBalances.get(e.employeeId) || { debit: 0, credit: 0 };
      employeeBalances.set(e.employeeId, { debit: cur.debit + d, credit: cur.credit + c });
    }
  }

  // 1. Classify balance-sheet accounts via shared helper
  const parentCompanyId = await storage.getParentCompanyId();
  const shouldIncludeSuppliers = parentCompanyId === null || companyId === parentCompanyId;

  const classified = classifyNetPositionAccounts(companyAccounts, accountBalances, {
    includeSupplierTypeAccounts: shouldIncludeSuppliers,
  });
  let forUsTotal = classified.forUsTotal;
  let onUsTotal  = classified.onUsTotal;

  // 2. Stock on floor — historical inventory as of toDate
  const activeLocationsData = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
    .execute();
  const activeLocationIds = activeLocationsData.map((l) => l.id);

  if (activeLocationIds.length > 0) {
    const allHistorical = await Promise.all(
      activeLocationIds.map((locId) =>
        calculateHistoricalLocationInventory(locId, companyId, toDate)
      )
    );
    for (const items of allHistorical) {
      for (const inv of items) {
        const qty  = parseFloat(inv.quantity    || "0");
        const rate = parseFloat(inv.averageRate || "0");
        if (qty > 0) forUsTotal += qty * rate;
      }
    }
  }

  // 3. Employee balances from voucher entries (advances = asset; owed salary = liability)
  const companyEmployees = await db
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt)))
    .execute();

  for (const emp of companyEmployees) {
    const opening     = parseFloat((emp as any).openingBalance     || "0");
    const openingSide = (emp as any).openingBalanceSide === "Dr" ? 1 : -1;
    const signedOpening = opening * openingSide;
    const balance = employeeBalances.get(emp.id) || { debit: 0, credit: 0 };
    const netBalance = signedOpening + balance.debit - balance.credit;
    if (netBalance < 0) onUsTotal  += Math.abs(netBalance);
    else if (netBalance > 0) forUsTotal += netBalance;
  }

  // 4. Supplier balances (parent company only — same restriction as dashboard)
  if (shouldIncludeSuppliers) {
    const allSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
    for (const sup of allSuppliers) {
      const balance = supplierBalances.get(sup.id);
      if (balance) {
        const opening    = parseFloat(sup.openingBalance || "0");
        const netBalance = opening + balance.credit - balance.debit;
        if (netBalance > 0) onUsTotal  += netBalance;
        else if (netBalance < 0) forUsTotal += Math.abs(netBalance);
      }
    }
  }

  // 5. Stock OTW — containers in transit on toDate
  //    importDate ≤ toDate AND (offloadDate IS NULL OR offloadDate > toDate)
  const otwContainers = await db
    .select({ grandTotal: containers.grandTotal, itemsTotal: containers.itemsTotal })
    .from(containers)
    .where(and(
      eq(containers.companyId, companyId),
      lte(containers.importDate, toDate),
      or(isNull(containers.offloadDate), sql`${containers.offloadDate} > ${toDate}`)
    ))
    .execute();

  for (const c of otwContainers) {
    forUsTotal += parseFloat(c.grandTotal || c.itemsTotal || "0");
  }

  // Final rounding (matches dashboard)
  forUsTotal = round2(forUsTotal);
  onUsTotal  = round2(onUsTotal);
  const netPosition = round2(forUsTotal - onUsTotal);

  return {
    forUsTotal,
    onUsTotal,
    netPosition,
    netPositionLabel: netPosition >= 0 ? "We Have More" : "We Owe More",
  };
}
