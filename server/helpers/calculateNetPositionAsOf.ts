/**
 * Shared helper: calculate the ERP net position as of a specific date.
 *
 * Returns the four summary values PLUS a full breakdown of every line item
 * on both sides (What We Have / What We Owe) so callers can build detailed
 * per-month sheets.
 */

import { db } from "../db";
import { storage } from "../storage";
import {
  vouchers, locations, employees, suppliers, containers,
} from "@shared/schema";
import { eq, and, or, isNull, lte, sql } from "drizzle-orm";
import { classifyNetPositionAccounts, round2 } from "../netPositionHelper";
import { calculateHistoricalLocationInventory } from "../routes/_helpers";

export interface NetPositionLineItem {
  label: string;
  value: number;
  category: string;
  side: "forUs" | "onUs";
}

export interface NetPositionSnapshot {
  forUsTotal: number;
  onUsTotal: number;
  netPosition: number;
  netPositionLabel: string;
  forUsLines: NetPositionLineItem[];
  onUsLines: NetPositionLineItem[];
}

export async function calculateNetPositionAsOf(
  companyId: number,
  toDate: string, // YYYY-MM-DD
): Promise<NetPositionSnapshot> {
  const companyAccounts = await storage.getAllLedgerAccounts(companyId, true);
  const companyRow = await storage.getCompanyById(companyId);
  const isSupplierPartner = (companyRow as any)?.companyType === "supplier_partner";

  // Push the summation to PostgreSQL — avoids transferring every individual
  // entry row over the wire. The index vouchers_company_date_idx covers the
  // WHERE clause; GROUP BY collapses millions of rows to one per account/
  // supplier/employee combination before the result leaves the DB.
  const grouped = await db.execute(sql`
    SELECT
      ve.ledger_account_id,
      ve.supplier_id,
      ve.employee_id,
      SUM(CAST(ve.debit_amount  AS numeric)) AS total_debit,
      SUM(CAST(ve.credit_amount AS numeric)) AS total_credit
    FROM voucher_entries ve
    INNER JOIN vouchers v ON ve.voucher_id = v.id
    WHERE v.company_id  = ${companyId}
      AND v.optional    = false
      AND v.deleted_at  IS NULL
      AND v.voucher_date <= ${toDate}
    GROUP BY ve.ledger_account_id, ve.supplier_id, ve.employee_id
  `);

  const accountBalances  = new Map<number, { debit: number; credit: number }>();
  const supplierBalances = new Map<number, { debit: number; credit: number }>();
  const employeeBalances = new Map<number, { debit: number; credit: number }>();

  for (const row of grouped.rows as any[]) {
    const d = parseFloat(row.total_debit  || "0");
    const c = parseFloat(row.total_credit || "0");
    if (row.ledger_account_id != null) {
      const id  = Number(row.ledger_account_id);
      const cur = accountBalances.get(id) || { debit: 0, credit: 0 };
      accountBalances.set(id, { debit: cur.debit + d, credit: cur.credit + c });
    }
    if (row.supplier_id != null) {
      const id  = Number(row.supplier_id);
      const cur = supplierBalances.get(id) || { debit: 0, credit: 0 };
      supplierBalances.set(id, { debit: cur.debit + d, credit: cur.credit + c });
    }
    if (row.employee_id != null) {
      const id  = Number(row.employee_id);
      const cur = employeeBalances.get(id) || { debit: 0, credit: 0 };
      employeeBalances.set(id, { debit: cur.debit + d, credit: cur.credit + c });
    }
  }

  const parentCompanyId = await storage.getParentCompanyId();
  const shouldIncludeSuppliers = parentCompanyId === null || companyId === parentCompanyId;

  // SP: exclude sp_stock accounts to avoid double-counting with inventory table
  // (sp_stock is an internal counterpart to the ERP inventory table, hidden from display)
  const accountsForClassify = companyAccounts.filter((a: any) => a.subType !== "sp_stock");
  const classified = classifyNetPositionAccounts(accountsForClassify, accountBalances, {
    includeSupplierTypeAccounts: shouldIncludeSuppliers,
  });

  let forUsTotal = classified.forUsTotal;
  let onUsTotal  = classified.onUsTotal;

  const forUsLines: NetPositionLineItem[] = classified.forUsAccounts.map((a) => ({
    label:    a.name,
    value:    round2(a.value),
    category: a.category,
    side:     "forUs",
  }));
  const onUsLines: NetPositionLineItem[] = classified.onUsAccounts.map((a) => ({
    label:    a.name,
    value:    round2(a.value),
    category: a.category,
    side:     "onUs",
  }));

  // ── Stock on floor ────────────────────────────────────────────────────
  const activeLocationsData = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
    .execute();
  const activeLocationIds = activeLocationsData.map((l) => l.id);

  let stockFloorTotal = 0;
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
        if (qty > 0) stockFloorTotal += qty * rate;
      }
    }
  }
  stockFloorTotal = round2(stockFloorTotal);
  if (stockFloorTotal !== 0) {
    forUsTotal += stockFloorTotal;
    forUsLines.push({ label: "Stock In Hand (Inventory)", value: stockFloorTotal, category: "Inventory", side: "forUs" });
  }

  // ── Employee advances / liabilities ──────────────────────────────────
  const companyEmployees = await db
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt)))
    .execute();

  let employeeAdvanceTotal   = 0;
  let employeeLiabilityTotal = 0;
  for (const emp of companyEmployees) {
    const opening     = parseFloat((emp as any).openingBalance     || "0");
    const openingSide = (emp as any).openingBalanceSide === "Dr" ? 1 : -1;
    const signedOpening = opening * openingSide;
    const balance = employeeBalances.get(emp.id) || { debit: 0, credit: 0 };
    const netBalance = signedOpening + balance.debit - balance.credit;
    if (netBalance < 0) {
      onUsTotal  += Math.abs(netBalance);
      employeeLiabilityTotal += Math.abs(netBalance);
    } else if (netBalance > 0) {
      forUsTotal += netBalance;
      employeeAdvanceTotal += netBalance;
    }
  }
  if (employeeAdvanceTotal > 0) {
    forUsLines.push({ label: "Employee Advances", value: round2(employeeAdvanceTotal), category: "Advances", side: "forUs" });
  }
  if (employeeLiabilityTotal > 0) {
    onUsLines.push({ label: "Owed to Employees", value: round2(employeeLiabilityTotal), category: "Payables", side: "onUs" });
  }

  // ── Supplier balances ─────────────────────────────────────────────────
  if (shouldIncludeSuppliers) {
    const allSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
    let supplierTotal = 0;
    for (const sup of allSuppliers) {
      const balance = supplierBalances.get(sup.id);
      if (balance) {
        const opening    = parseFloat(sup.openingBalance || "0");
        const netBalance = opening + balance.credit - balance.debit;
        if (netBalance > 0) {
          onUsTotal  += netBalance;
          supplierTotal += netBalance;
        } else if (netBalance < 0) {
          forUsTotal += Math.abs(netBalance);
          forUsLines.push({ label: `Supplier Credit: ${sup.name}`, value: round2(Math.abs(netBalance)), category: "Supplier Credits", side: "forUs" });
        }
      }
    }
    if (supplierTotal > 0) {
      onUsLines.push({ label: "Supplier Payables", value: round2(supplierTotal), category: "Payables", side: "onUs" });
    }
  }

  // ── Stock OTW ─────────────────────────────────────────────────────────
  // SP companies track OTW via their sp_goods_otw ledger account ("Goods On The Way"),
  // so we skip the containers-based calculation to avoid double-counting.
  if (!isSupplierPartner) {
    const otwContainers = await db
      .select({ grandTotal: containers.grandTotal, itemsTotal: containers.itemsTotal })
      .from(containers)
      .where(and(
        eq(containers.companyId, companyId),
        lte(containers.importDate, toDate),
        or(isNull(containers.offloadDate), sql`${containers.offloadDate} > ${toDate}`)
      ))
      .execute();

    let otwTotal = 0;
    for (const c of otwContainers) {
      otwTotal += parseFloat(c.grandTotal || c.itemsTotal || "0");
    }
    otwTotal = round2(otwTotal);
    if (otwTotal !== 0) {
      forUsTotal += otwTotal;
      forUsLines.push({ label: "Stock On The Way (OTW)", value: otwTotal, category: "In Transit", side: "forUs" });
    }
  }

  forUsTotal = round2(forUsTotal);
  onUsTotal  = round2(onUsTotal);
  const netPosition = round2(forUsTotal - onUsTotal);

  return {
    forUsTotal,
    onUsTotal,
    netPosition,
    netPositionLabel: netPosition >= 0 ? "We Have More" : "We Owe More",
    forUsLines,
    onUsLines,
  };
}
