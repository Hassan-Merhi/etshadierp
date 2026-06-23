import { storage } from "../storage";
import { db } from "../db";
import multer from "multer";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import {
  inventory,
  salesItems,
  vouchers,
  voucherEntries,
  containerOffloadItems,
  containerOffloads,
  containers,
  stockAdjustmentItems,
  stockAdjustmentVouchers,
  stockTransferItems,
  stockTransferVouchers,
  intercompanyPosConfigs,
  companies,
  ledgerAccounts,
  auditLog,
  employees,
  bankAccounts,
  suppliers,
  customers,
  factorySuppliers,
  stockItems as stockItemsTable,
  stockGroups as stockGroupsTable,
  stockCategories as stockCategoriesTable,
} from "@shared/schema";
import { eq, and, sql, gt, ilike, isNull, inArray } from "drizzle-orm";

// ─── Multer ───────────────────────────────────────────────────────────────────
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── Password helpers ─────────────────────────────────────────────────────────
const BCRYPT_SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

export function isLegacySHA256Hash(hash: string): boolean {
  return hash.length === 64 && /^[a-f0-9]+$/i.test(hash);
}

export function verifyLegacyPassword(password: string, hash: string): boolean {
  const sha256Hash = CryptoJS.SHA256(password).toString().toLowerCase();
  return sha256Hash === (hash || "").toLowerCase();
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (isLegacySHA256Hash(hash)) {
    const isValid = verifyLegacyPassword(password, hash);
    return { valid: isValid, needsMigration: isValid };
  }
  const isValid = await bcrypt.compare(password, hash);
  return { valid: isValid, needsMigration: false };
}

// ─── Audit log ────────────────────────────────────────────────────────────────
export async function logAudit(params: {
  userId: string;
  username: string;
  companyId?: number | null;
  action: "create" | "update" | "delete";
  tableName: string;
  recordId?: number | null;
  recordIdentifier?: string | null;
  changes?: Record<string, { old: any; new: any }> | null;
}) {
  try {
    await db.insert(auditLog).values({
      userId: params.userId,
      username: params.username,
      companyId: params.companyId,
      action: params.action,
      tableName: params.tableName,
      recordId: params.recordId,
      recordIdentifier: params.recordIdentifier,
      changes: params.changes,
    });
  } catch (error) {
    console.error("Error logging audit:", error);
    throw error;
  }
}

// ─── Voucher audit helpers ─────────────────────────────────────────────────────

type EntrySnap = { account: string; debit: string; credit: string; narration?: string };
type VoucherSnap = {
  voucherType?: string | null;
  voucherDate?: string | null;
  totalAmount?: string | null;
  description?: string | null;
  locationName?: string | null;
  locationId?: number | null;
  optional?: boolean | null;
};

export async function snapshotVoucherEntries(
  entries: Array<{
    ledgerAccountId?: number | null;
    bankAccountId?: number | null;
    supplierId?: number | null;
    employeeId?: number | null;
    customerId?: number | null;
    factorySupplierId?: number | null;
    debitAmount?: string | null;
    creditAmount?: string | null;
    narration?: string | null;
  }>
): Promise<EntrySnap[]> {
  // Resolve ledger account names
  const ledgerIds = [...new Set(entries.map((e) => e.ledgerAccountId).filter((id): id is number => id != null))];
  const ledgerNames: Record<number, string> = {};
  if (ledgerIds.length > 0) {
    const accts = await db
      .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, ledgerIds));
    accts.forEach((a) => {
      ledgerNames[a.id] = a.name;
    });
  }

  // Resolve bank account names
  const bankIds = [...new Set(entries.map((e) => e.bankAccountId).filter((id): id is number => id != null))];
  const bankNames: Record<number, string> = {};
  if (bankIds.length > 0) {
    const bnks = await db
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(inArray(bankAccounts.id, bankIds));
    bnks.forEach((b) => {
      bankNames[b.id] = b.name;
    });
  }

  // Resolve supplier names
  const supplierIds = [...new Set(entries.map((e) => e.supplierId).filter((id): id is number => id != null))];
  const supplierNames: Record<number, string> = {};
  if (supplierIds.length > 0) {
    const supps = await db
      .select({ id: suppliers.id, name: suppliers.legalName })
      .from(suppliers)
      .where(inArray(suppliers.id, supplierIds));
    supps.forEach((s) => {
      supplierNames[s.id] = s.name;
    });
  }

  // Resolve employee names (firstName + lastName)
  const employeeIds = [...new Set(entries.map((e) => e.employeeId).filter((id): id is number => id != null))];
  const employeeNames: Record<number, string> = {};
  if (employeeIds.length > 0) {
    const emps = await db
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(inArray(employees.id, employeeIds));
    emps.forEach((emp) => {
      employeeNames[emp.id] = `${emp.firstName} ${emp.lastName}`.trim();
    });
  }

  // Resolve customer names
  const customerIds = [...new Set(entries.map((e) => e.customerId).filter((id): id is number => id != null))];
  const customerNames: Record<number, string> = {};
  if (customerIds.length > 0) {
    const custs = await db
      .select({ id: customers.id, name: customers.legalName })
      .from(customers)
      .where(inArray(customers.id, customerIds));
    custs.forEach((c) => {
      customerNames[c.id] = c.name;
    });
  }

  // Resolve factory supplier names
  const factorySupplierIds = [
    ...new Set(entries.map((e) => e.factorySupplierId).filter((id): id is number => id != null)),
  ];
  const factorySupplierNames: Record<number, string> = {};
  if (factorySupplierIds.length > 0) {
    const fsupps = await db
      .select({ id: factorySuppliers.id, name: factorySuppliers.name })
      .from(factorySuppliers)
      .where(inArray(factorySuppliers.id, factorySupplierIds));
    fsupps.forEach((s) => {
      factorySupplierNames[s.id] = s.name;
    });
  }

  return entries.map((e) => {
    const account = e.ledgerAccountId
      ? (ledgerNames[e.ledgerAccountId] ?? `Account #${e.ledgerAccountId}`)
      : e.bankAccountId
        ? (bankNames[e.bankAccountId] ?? `Bank #${e.bankAccountId}`)
        : e.supplierId
          ? (supplierNames[e.supplierId] ?? `Supplier #${e.supplierId}`)
          : e.employeeId
            ? (employeeNames[e.employeeId] ?? `Employee #${e.employeeId}`)
            : e.customerId
              ? (customerNames[e.customerId] ?? `Customer #${e.customerId}`)
              : e.factorySupplierId
                ? (factorySupplierNames[e.factorySupplierId] ?? `Supplier #${e.factorySupplierId}`)
                : "—";
    const snap: EntrySnap = { account, debit: e.debitAmount || "0", credit: e.creditAmount || "0" };
    if (e.narration) snap.narration = e.narration;
    return snap;
  });
}

export function buildVoucherChangesForCreate(v: VoucherSnap, entries: EntrySnap[]): Record<string, { new: any }> {
  const c: Record<string, { new: any }> = {};
  if (v.voucherType) c.voucherType = { new: v.voucherType };
  if (v.voucherDate) c.date = { new: v.voucherDate };
  if (v.totalAmount) c.amount = { new: v.totalAmount };
  if (v.description) c.description = { new: v.description };
  if (v.locationName || v.locationId) c.location = { new: v.locationName ?? `Location #${v.locationId}` };
  if (entries.length > 0) c.entries = { new: entries };
  return c;
}

export function buildVoucherChangesForDelete(v: VoucherSnap, entries: EntrySnap[]): Record<string, { old: any }> {
  const c: Record<string, { old: any }> = {};
  if (v.voucherType) c.voucherType = { old: v.voucherType };
  if (v.voucherDate) c.date = { old: v.voucherDate };
  if (v.totalAmount) c.amount = { old: v.totalAmount };
  if (v.description) c.description = { old: v.description };
  if (v.locationName || v.locationId) c.location = { old: v.locationName ?? `Location #${v.locationId}` };
  if (entries.length > 0) c.entries = { old: entries };
  return c;
}

export function buildVoucherChangesForUpdate(
  oldV: VoucherSnap,
  newV: VoucherSnap,
  oldEntries: EntrySnap[],
  newEntries: EntrySnap[]
): Record<string, { old: any; new: any }> {
  const c: Record<string, { old: any; new: any }> = {};
  if (oldV.voucherType !== newV.voucherType) c.voucherType = { old: oldV.voucherType, new: newV.voucherType };
  if (oldV.voucherDate !== newV.voucherDate) c.date = { old: oldV.voucherDate, new: newV.voucherDate };
  if (parseFloat(oldV.totalAmount || "0") !== parseFloat(newV.totalAmount || "0"))
    c.amount = { old: oldV.totalAmount, new: newV.totalAmount };
  if ((oldV.description ?? "") !== (newV.description ?? ""))
    c.description = { old: oldV.description ?? "", new: newV.description ?? "" };
  if (oldV.locationId !== newV.locationId)
    c.location = {
      old: oldV.locationName ?? (oldV.locationId ? `Location #${oldV.locationId}` : null),
      new: newV.locationName ?? (newV.locationId ? `Location #${newV.locationId}` : null),
    };
  if (oldV.optional !== newV.optional) c.optional = { old: oldV.optional, new: newV.optional };
  if (JSON.stringify(oldEntries) !== JSON.stringify(newEntries)) c.entries = { old: oldEntries, new: newEntries };
  return c;
}

// ─── Exchange rate ────────────────────────────────────────────────────────────
export async function getCurrentExchangeRate(companyId: number): Promise<string | null> {
  try {
    const company = await storage.getCompanyById(companyId);
    if (!company || !company.displayCurrency || !company.baseCurrency) {
      return null;
    }
    const rate = await storage.getLatestExchangeRate(companyId, company.baseCurrency, company.displayCurrency);
    return rate?.rate || null;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return null;
  }
}

// ─── Intercompany POS ─────────────────────────────────────────────────────────
export async function runIntercompanyPosTransfer(
  sourceCompanyId: number,
  cashAccountId: number,
  saleAmount: number,
  saleDateStr: string
) {
  try {
    const [config] = await db
      .select()
      .from(intercompanyPosConfigs)
      .where(eq(intercompanyPosConfigs.sourceCompanyId, sourceCompanyId));
    if (!config || !config.enabled) return;

    const [srcCompanyRow] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, sourceCompanyId));
    const [dstCompanyRow] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, config.destCompanyId));
    const srcCompanyName = srcCompanyRow?.name ?? `Company ${sourceCompanyId}`;
    const dstCompanyName = dstCompanyRow?.name ?? `Company ${config.destCompanyId}`;

    const [cashAccount] = await db
      .select({ name: ledgerAccounts.name })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, cashAccountId));
    if (!cashAccount) return;
    const cashName = cashAccount.name;

    let destCashAccounts = await db
      .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, config.destCompanyId), eq(ledgerAccounts.name, cashName)));
    if (destCashAccounts.length === 0) {
      destCashAccounts = await db
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, config.destCompanyId), ilike(ledgerAccounts.name, cashName)));
    }
    const destCashAccount = destCashAccounts[0] ?? null;

    // Source voucher: Dr sourceIntercoAccount / Cr Cash (skipped for SP companies to avoid
    // reducing Cash in Net Position — only the dest-side voucher is needed in that case)
    if (!config.skipSourceVoucher) {
      const srcVoucherNum = `INTERCO-SRC-${sourceCompanyId}-${saleDateStr}`;
      const srcNarration = `Cash transferred to ${dstCompanyName} – ${saleDateStr}`;
      await upsertIntercompanyVoucher({
        companyId: sourceCompanyId,
        voucherNumber: srcVoucherNum,
        date: saleDateStr,
        narration: srcNarration,
        debitAccountId: config.sourceIntercoAccountId,
        creditAccountId: cashAccountId,
        amount: saleAmount,
      });
    }

    if (destCashAccount) {
      const dstVoucherNum = `INTERCO-DST-${config.destCompanyId}-${saleDateStr}`;
      const dstNarration = `Cash received from ${srcCompanyName} – ${saleDateStr}`;
      await upsertIntercompanyVoucher({
        companyId: config.destCompanyId,
        voucherNumber: dstVoucherNum,
        date: saleDateStr,
        narration: dstNarration,
        debitAccountId: destCashAccount.id,
        creditAccountId: config.destIntercoAccountId,
        amount: saleAmount,
        debitIsRunningTotal: false,
      });
    } else {
      console.warn(
        `[IntercompanyPOS] Could not find cash account "${cashName}" in company ${config.destCompanyId}. Dest voucher skipped.`
      );
    }
  } catch (err: any) {
    console.error("[IntercompanyPOS] Auto-transfer failed:", err?.message ?? err);
  }
}

// ─── Recalculate Intercompany POS for a specific date ─────────────────────────
// Deletes the existing INTERCO-SRC/DST vouchers for the date and rebuilds them
// from all non-deleted cash Sales vouchers for that company+date.
export async function recalculateIntercompanyForDate(companyId: number, date: string) {
  try {
    const [config] = await db
      .select()
      .from(intercompanyPosConfigs)
      .where(eq(intercompanyPosConfigs.sourceCompanyId, companyId));
    if (!config || !config.enabled) return;

    // Step 1: Delete existing INTERCO vouchers for this date so we can rebuild
    const srcVoucherNum = `INTERCO-SRC-${companyId}-${date}`;
    const dstVoucherNum = `INTERCO-DST-${config.destCompanyId}-${date}`;

    for (const [cId, vNum] of [
      [companyId, srcVoucherNum],
      [config.destCompanyId, dstVoucherNum],
    ] as [number, string][]) {
      const [existing] = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(eq(vouchers.companyId, cId), eq(vouchers.voucherNumber, vNum)));
      if (existing) {
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, existing.id));
        await db.delete(vouchers).where(eq(vouchers.id, existing.id));
      }
    }

    // Step 2: Find all non-deleted Sales vouchers for this company+date
    const daySales = await db
      .select({ id: vouchers.id })
      .from(vouchers)
      .where(
        and(
          eq(vouchers.companyId, companyId),
          eq(vouchers.voucherType, "Sales"),
          eq(vouchers.voucherDate, date),
          isNull(vouchers.deletedAt)
        )
      );

    // Step 3: For each voucher, find debit entries that belong to Cash-type accounts
    for (const sv of daySales) {
      const debitEntries = await db
        .select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          debitAmount: voucherEntries.debitAmount,
        })
        .from(voucherEntries)
        .where(and(eq(voucherEntries.voucherId, sv.id), sql`${voucherEntries.debitAmount}::numeric > 0`));

      for (const entry of debitEntries) {
        if (!entry.ledgerAccountId) continue;

        const [account] = await db
          .select({ accountType: ledgerAccounts.accountType })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.id, entry.ledgerAccountId))
          .limit(1);

        if (!account || account.accountType !== "Cash") continue;

        const amount = parseFloat(entry.debitAmount || "0");
        if (amount <= 0) continue;

        // Re-run interco transfer for this cash sale entry
        await runIntercompanyPosTransfer(companyId, entry.ledgerAccountId, amount, date);
      }
    }
  } catch (err: any) {
    console.error("[IntercompanyPOS Recalc] Error:", err?.message ?? err);
  }
}

async function upsertIntercompanyVoucher(opts: {
  companyId: number;
  voucherNumber: string;
  date: string;
  narration: string;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  debitIsRunningTotal?: boolean;
}) {
  const { companyId, voucherNumber, date, narration, debitAccountId, creditAccountId, amount } = opts;
  const debitIsRunningTotal = opts.debitIsRunningTotal ?? true;

  const [existing] = await db
    .select()
    .from(vouchers)
    .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, voucherNumber)));

  if (existing) {
    await db.update(vouchers).set({ description: narration }).where(eq(vouchers.id, existing.id));

    const entries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, existing.id));

    if (debitIsRunningTotal) {
      const existingCrEntry = entries.find(
        (e) => e.ledgerAccountId === creditAccountId && parseFloat(e.creditAmount ?? "0") > 0
      );
      if (existingCrEntry) {
        const newCr = (parseFloat(existingCrEntry.creditAmount ?? "0") + amount).toFixed(2);
        await db.update(voucherEntries).set({ creditAmount: newCr }).where(eq(voucherEntries.id, existingCrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: creditAccountId,
          debitAmount: "0",
          creditAmount: amount.toFixed(2),
          narration,
        });
      }

      const refreshed = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, existing.id));
      const totalCr = refreshed
        .filter((e) => e.ledgerAccountId !== debitAccountId)
        .reduce((s, e) => s + parseFloat(e.creditAmount ?? "0"), 0);

      const existingDrEntry = refreshed.find(
        (e) => e.ledgerAccountId === debitAccountId && parseFloat(e.debitAmount ?? "0") > 0
      );
      if (existingDrEntry) {
        await db
          .update(voucherEntries)
          .set({ debitAmount: totalCr.toFixed(2) })
          .where(eq(voucherEntries.id, existingDrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: debitAccountId,
          debitAmount: totalCr.toFixed(2),
          creditAmount: "0",
          narration,
        });
      }
      await db
        .update(vouchers)
        .set({ totalAmount: totalCr.toFixed(2) })
        .where(eq(vouchers.id, existing.id));
    } else {
      const existingDrEntry = entries.find(
        (e) => e.ledgerAccountId === debitAccountId && parseFloat(e.debitAmount ?? "0") > 0
      );
      if (existingDrEntry) {
        const newDr = (parseFloat(existingDrEntry.debitAmount ?? "0") + amount).toFixed(2);
        await db.update(voucherEntries).set({ debitAmount: newDr }).where(eq(voucherEntries.id, existingDrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: debitAccountId,
          debitAmount: amount.toFixed(2),
          creditAmount: "0",
          narration,
        });
      }

      const refreshed = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, existing.id));
      const totalDr = refreshed
        .filter((e) => e.ledgerAccountId !== creditAccountId)
        .reduce((s, e) => s + parseFloat(e.debitAmount ?? "0"), 0);

      const existingCrEntry = refreshed.find(
        (e) => e.ledgerAccountId === creditAccountId && parseFloat(e.creditAmount ?? "0") > 0
      );
      if (existingCrEntry) {
        await db
          .update(voucherEntries)
          .set({ creditAmount: totalDr.toFixed(2) })
          .where(eq(voucherEntries.id, existingCrEntry.id));
      } else {
        await db.insert(voucherEntries).values({
          voucherId: existing.id,
          ledgerAccountId: creditAccountId,
          debitAmount: "0",
          creditAmount: totalDr.toFixed(2),
          narration,
        });
      }
      await db
        .update(vouchers)
        .set({ totalAmount: totalDr.toFixed(2) })
        .where(eq(vouchers.id, existing.id));
    }
  } else {
    const [newVoucher] = await db
      .insert(vouchers)
      .values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        description: narration,
        voucherDate: date,
        totalAmount: amount.toFixed(2),
        sourceModule: "ERP",
      })
      .returning();

    await db.insert(voucherEntries).values({
      voucherId: newVoucher.id,
      ledgerAccountId: debitAccountId,
      debitAmount: amount.toFixed(2),
      creditAmount: "0",
      narration,
    });
    await db.insert(voucherEntries).values({
      voucherId: newVoucher.id,
      ledgerAccountId: creditAccountId,
      debitAmount: "0",
      creditAmount: amount.toFixed(2),
      narration,
    });
  }
}

// ─── Historical inventory ─────────────────────────────────────────────────────
export async function calculateHistoricalLocationInventory(
  locationId: number,
  companyId: number,
  asOfDate: string
): Promise<any[]> {
  const cutoffDateStr = asOfDate;
  const cutoffTimestamp = new Date(asOfDate + "T23:59:59.999");

  const seedStockItemIds = new Set<number>();

  const currentInventory = await db
    .select({
      stockItemId: inventory.stockItemId,
      quantity: inventory.quantity,
      averageRate: inventory.averageRate,
    })
    .from(inventory)
    .where(and(eq(inventory.locationId, locationId), eq(inventory.companyId, companyId)))
    .execute();

  for (const inv of currentInventory) seedStockItemIds.add(inv.stockItemId);

  const salesStockItems = await db
    .selectDistinct({ stockItemId: salesItems.stockItemId })
    .from(salesItems)
    .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
    .where(and(eq(vouchers.companyId, companyId), eq(vouchers.locationId, locationId)))
    .execute();
  for (const item of salesStockItems) seedStockItemIds.add(item.stockItemId);

  const offloadStockItems = await db
    .selectDistinct({ stockItemId: containerOffloadItems.stockItemId })
    .from(containerOffloadItems)
    .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
    .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
    .where(and(eq(containers.companyId, companyId), eq(containerOffloads.locationId, locationId)))
    .execute();
  for (const item of offloadStockItems) seedStockItemIds.add(item.stockItemId);

  const adjustmentStockItems = await db
    .selectDistinct({ stockItemId: stockAdjustmentItems.stockItemId })
    .from(stockAdjustmentItems)
    .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
    .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
    .where(and(eq(vouchers.companyId, companyId), eq(stockAdjustmentVouchers.locationId, locationId)))
    .execute();
  for (const item of adjustmentStockItems) seedStockItemIds.add(item.stockItemId);

  const transfersInStockItems = await db
    .selectDistinct({ stockItemId: stockTransferItems.stockItemId })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(and(eq(vouchers.companyId, companyId), eq(stockTransferVouchers.destinationLocationId, locationId)))
    .execute();
  for (const item of transfersInStockItems) seedStockItemIds.add(item.stockItemId);

  const transfersOutStockItems = await db
    .selectDistinct({ stockItemId: stockTransferItems.stockItemId })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(and(eq(vouchers.companyId, companyId), eq(stockTransferItems.sourceLocationId, locationId)))
    .execute();
  for (const item of transfersOutStockItems) seedStockItemIds.add(item.stockItemId);

  if (seedStockItemIds.size === 0) return [];

  const inventoryMap = new Map<number, { quantity: number; totalValue: number; rate: number }>();
  for (const stockItemId of Array.from(seedStockItemIds)) {
    inventoryMap.set(stockItemId, { quantity: 0, totalValue: 0, rate: 0 });
  }

  for (const inv of currentInventory) {
    const qty = parseFloat(inv.quantity) || 0;
    const rate = parseFloat(inv.averageRate) || 0;
    inventoryMap.set(inv.stockItemId, {
      quantity: qty,
      totalValue: qty * rate,
      rate,
    });
  }

  const salesAfterDate = await db
    .select({
      stockItemId: salesItems.stockItemId,
      quantity: salesItems.quantity,
      costPrice: salesItems.costPrice,
    })
    .from(salesItems)
    .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(vouchers.locationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const sale of salesAfterDate) {
    const qty = parseFloat(sale.quantity) || 0;
    const cost = parseFloat(sale.costPrice) || 0;
    const existing = inventoryMap.get(sale.stockItemId) || {
      quantity: 0,
      totalValue: 0,
      rate: 0,
    };
    existing.quantity += qty;
    existing.totalValue += qty * cost;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(sale.stockItemId, existing);
  }

  const adjustmentsAfterDate = await db
    .select({
      stockItemId: stockAdjustmentItems.stockItemId,
      quantity: stockAdjustmentItems.quantity,
      rate: stockAdjustmentItems.rate,
      adjustmentType: stockAdjustmentVouchers.adjustmentType,
    })
    .from(stockAdjustmentItems)
    .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
    .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockAdjustmentVouchers.locationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const adj of adjustmentsAfterDate) {
    const qty = parseFloat(adj.quantity) || 0;
    const rate = parseFloat(adj.rate) || 0;
    const existing = inventoryMap.get(adj.stockItemId) || {
      quantity: 0,
      totalValue: 0,
      rate: 0,
    };
    const adjType = (adj.adjustmentType || "").toLowerCase().trim();
    if (adjType === "production" || adjType === "produce") {
      existing.quantity -= qty;
      existing.totalValue -= qty * rate;
    } else {
      existing.quantity += qty;
      existing.totalValue += qty * rate;
    }
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(adj.stockItemId, existing);
  }

  const transfersInAfterDate = await db
    .select({
      stockItemId: stockTransferItems.stockItemId,
      quantity: stockTransferItems.quantity,
      rate: stockTransferItems.rate,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockTransferVouchers.destinationLocationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const transfer of transfersInAfterDate) {
    const qty = parseFloat(transfer.quantity) || 0;
    const rate = parseFloat(transfer.rate) || 0;
    const existing = inventoryMap.get(transfer.stockItemId) || {
      quantity: 0,
      totalValue: 0,
      rate: 0,
    };
    existing.quantity -= qty;
    existing.totalValue -= qty * rate;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(transfer.stockItemId, existing);
  }

  const transfersOutAfterDate = await db
    .select({
      stockItemId: stockTransferItems.stockItemId,
      quantity: stockTransferItems.quantity,
      rate: stockTransferItems.rate,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(stockTransferItems.sourceLocationId, locationId),
        eq(vouchers.optional, false),
        sql`${vouchers.voucherDate} > ${cutoffDateStr}`
      )
    )
    .execute();

  for (const transfer of transfersOutAfterDate) {
    const qty = parseFloat(transfer.quantity) || 0;
    const rate = parseFloat(transfer.rate) || 0;
    const existing = inventoryMap.get(transfer.stockItemId) || {
      quantity: 0,
      totalValue: 0,
      rate: 0,
    };
    existing.quantity += qty;
    existing.totalValue += qty * rate;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(transfer.stockItemId, existing);
  }

  const offloadsAfterDate = await db
    .select({
      stockItemId: containerOffloadItems.stockItemId,
      quantity: containerOffloadItems.quantity,
      rate: containerOffloadItems.rate,
    })
    .from(containerOffloadItems)
    .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
    .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
    .where(
      and(
        eq(containers.companyId, companyId),
        eq(containerOffloads.locationId, locationId),
        gt(containerOffloads.offloadedAt, cutoffTimestamp)
      )
    )
    .execute();

  for (const offload of offloadsAfterDate) {
    const qty = parseFloat(offload.quantity) || 0;
    const cost = parseFloat(offload.rate) || 0;
    const existing = inventoryMap.get(offload.stockItemId) || {
      quantity: 0,
      totalValue: 0,
      rate: 0,
    };
    existing.quantity -= qty;
    existing.totalValue -= qty * cost;
    if (existing.quantity > 0) existing.rate = existing.totalValue / existing.quantity;
    inventoryMap.set(offload.stockItemId, existing);
  }

  const stockItemIdList = Array.from(inventoryMap.keys());
  if (stockItemIdList.length === 0) return [];

  const itemDetails = await db
    .select({
      id: stockItemsTable.id,
      code: stockItemsTable.code,
      name: stockItemsTable.name,
      uom: stockItemsTable.uom,
      stockGroupId: stockItemsTable.stockGroupId,
      stockGroupName: sql<string>`COALESCE(${stockGroupsTable.name}, '')`,
      stockGroupCode: sql<string>`COALESCE(${stockGroupsTable.code}, '')`,
      categoryId: stockItemsTable.categoryId,
      categoryName: stockCategoriesTable.name,
      active: stockItemsTable.active,
    })
    .from(stockItemsTable)
    .leftJoin(stockGroupsTable, eq(stockItemsTable.stockGroupId, stockGroupsTable.id))
    .leftJoin(stockCategoriesTable, eq(stockItemsTable.categoryId, stockCategoriesTable.id))
    .where(inArray(stockItemsTable.id, stockItemIdList));

  const detailMap = new Map(itemDetails.map((d) => [d.id, d]));

  const results: any[] = [];
  for (const [stockItemId, data] of Array.from(inventoryMap.entries())) {
    const detail = detailMap.get(stockItemId);
    results.push({
      stockItemId,
      quantity: data.quantity.toString(),
      averageRate: data.rate.toString(),
      totalValue: data.totalValue.toString(),
      stockItemCode: detail?.code ?? "",
      stockItemName: detail?.name ?? "",
      stockItemUom: detail?.uom ?? "",
      stockGroupId: detail?.stockGroupId ?? null,
      stockGroupName: detail?.stockGroupName ?? "",
      stockGroupCode: detail?.stockGroupCode ?? "",
      categoryId: detail?.categoryId ?? null,
      categoryName: detail?.categoryName ?? null,
      stockItemActive: detail?.active ?? true,
    });
  }
  return results;
}

// ─── Employee balance sync ────────────────────────────────────────────────────
export async function syncEmployeeBalancesFromEntries(
  entries: Array<{
    ledgerAccountId: number | null;
    employeeId?: number | null;
    debitAmount: string | null;
    creditAmount: string | null;
  }>,
  companyId: number,
  reverse: boolean = false
): Promise<void> {
  const allAccounts = await storage.getAllLedgerAccounts(companyId);

  const employeeAccountMap = new Map<number, { code: string; employeeCode: string }>();
  for (const account of allAccounts) {
    if (account.code && account.code.startsWith("EMP-")) {
      const employeeCode = account.code.replace("EMP-", "");
      employeeAccountMap.set(account.id, { code: account.code, employeeCode });
    }
  }

  const employeeChangesById = new Map<number, { balanceChange: number; deposits: number; withdrawals: number }>();
  const employeeChangesByCode = new Map<string, { balanceChange: number; deposits: number; withdrawals: number }>();

  for (const entry of entries) {
    const debit = parseFloat(entry.debitAmount || "0");
    const credit = parseFloat(entry.creditAmount || "0");
    let balanceChange = credit - debit;
    if (reverse) balanceChange = -balanceChange;
    const depositChange = reverse ? -credit : credit;
    const withdrawalChange = reverse ? -debit : debit;

    if (entry.employeeId) {
      const current = employeeChangesById.get(entry.employeeId) || {
        balanceChange: 0,
        deposits: 0,
        withdrawals: 0,
      };
      employeeChangesById.set(entry.employeeId, {
        balanceChange: current.balanceChange + balanceChange,
        deposits: current.deposits + depositChange,
        withdrawals: current.withdrawals + withdrawalChange,
      });
      continue;
    }

    if (entry.ledgerAccountId) {
      const employeeAccount = employeeAccountMap.get(entry.ledgerAccountId);
      if (employeeAccount) {
        const current = employeeChangesByCode.get(employeeAccount.employeeCode) || {
          balanceChange: 0,
          deposits: 0,
          withdrawals: 0,
        };
        employeeChangesByCode.set(employeeAccount.employeeCode, {
          balanceChange: current.balanceChange + balanceChange,
          deposits: current.deposits + depositChange,
          withdrawals: current.withdrawals + withdrawalChange,
        });
      }
    }
  }

  for (const [employeeId, changes] of Array.from(employeeChangesById.entries())) {
    if (changes.balanceChange === 0 && changes.deposits === 0 && changes.withdrawals === 0) continue;
    const employee = await storage.getEmployeeById(employeeId);
    if (!employee) continue;
    const newBalance = parseFloat(employee.currentBalance || "0") + changes.balanceChange;
    const newDeposits = Math.max(0, parseFloat(employee.totalDeposits || "0") + changes.deposits);
    const newWithdrawals = Math.max(0, parseFloat(employee.totalWithdrawals || "0") + changes.withdrawals);
    await db
      .update(employees)
      .set({
        currentBalance: newBalance.toFixed(2),
        totalDeposits: newDeposits.toFixed(2),
        totalWithdrawals: newWithdrawals.toFixed(2),
      })
      .where(eq(employees.id, employee.id));
  }

  for (const [employeeCode, changes] of Array.from(employeeChangesByCode.entries())) {
    if (changes.balanceChange === 0 && changes.deposits === 0 && changes.withdrawals === 0) continue;
    const employee = await storage.getEmployeeByCode(employeeCode);
    if (!employee) continue;
    const newBalance = parseFloat(employee.currentBalance || "0") + changes.balanceChange;
    const newDeposits = Math.max(0, parseFloat(employee.totalDeposits || "0") + changes.deposits);
    const newWithdrawals = Math.max(0, parseFloat(employee.totalWithdrawals || "0") + changes.withdrawals);
    await db
      .update(employees)
      .set({
        currentBalance: newBalance.toFixed(2),
        totalDeposits: newDeposits.toFixed(2),
        totalWithdrawals: newWithdrawals.toFixed(2),
      })
      .where(eq(employees.id, employee.id));
  }
}

// ─── Item-level diff builder ───────────────────────────────────────────────────
export async function buildItemLevelChanges(
  oldItems: Array<{
    stockItemId?: number | null;
    itemName?: string | null;
    quantity?: string | number | null;
    rate?: string | number | null;
    totalAmount?: string | number | null;
    lineTotal?: string | number | null;
    totalValue?: string | number | null;
  }>,
  newItems: Array<{
    stockItemId?: number | null;
    itemName?: string | null;
    quantity?: string | number | null;
    rate?: string | number | null;
    totalAmount?: string | number | null;
    lineTotal?: string | number | null;
    totalValue?: string | number | null;
  }>,
  resolveNameFn?: (id: number) => Promise<string>
): Promise<Record<string, { old?: string; new?: string }>> {
  const nameCache = new Map<number, string>();
  async function getName(id: number | null | undefined, hint?: string | null): Promise<string> {
    if (hint) return hint;
    if (!id) return "Unknown Item";
    if (nameCache.has(id)) return nameCache.get(id)!;
    const name = resolveNameFn ? await resolveNameFn(id) : `Item #${id}`;
    nameCache.set(id, name);
    return name;
  }

  const oldMap = new Map<number, (typeof oldItems)[0]>();
  for (const item of oldItems) {
    if (item.stockItemId != null) oldMap.set(item.stockItemId, item);
  }
  const newMap = new Map<number, (typeof newItems)[0]>();
  for (const item of newItems) {
    if (item.stockItemId != null) newMap.set(item.stockItemId, item);
  }

  const changes: Record<string, { old?: string; new?: string }> = {};
  let idx = 0;

  for (const [id, item] of newMap) {
    if (!oldMap.has(id)) {
      const name = await getName(id, item.itemName);
      const qty = String(item.quantity ?? "");
      const rate = String(item.rate ?? "");
      const total = String(item.totalAmount ?? item.lineTotal ?? item.totalValue ?? "");
      changes[`item_added_${++idx}`] = {
        new: `Added ${name}, quantity ${qty}, unit price ${rate}, total ${total}`,
      };
    }
  }

  for (const [id, item] of oldMap) {
    if (!newMap.has(id)) {
      const name = await getName(id, item.itemName);
      const qty = String(item.quantity ?? "");
      const rate = String(item.rate ?? "");
      const total = String(item.totalAmount ?? item.lineTotal ?? item.totalValue ?? "");
      changes[`item_removed_${++idx}`] = {
        old: `Removed ${name}, quantity ${qty}, rate ${rate}, total ${total}`,
      };
    }
  }

  for (const [id, newItem] of newMap) {
    const oldItem = oldMap.get(id);
    if (!oldItem) continue;
    const name = await getName(id, newItem.itemName ?? oldItem.itemName);
    const fieldChanges: string[] = [];
    const qn = parseFloat(String(newItem.quantity ?? 0));
    const qo = parseFloat(String(oldItem.quantity ?? 0));
    if (!isNaN(qn) && !isNaN(qo) && Math.abs(qn - qo) > 0.0001) {
      fieldChanges.push(`quantity from ${qo} to ${qn}`);
    }
    const rn = parseFloat(String(newItem.rate ?? 0));
    const ro = parseFloat(String(oldItem.rate ?? 0));
    if (!isNaN(rn) && !isNaN(ro) && Math.abs(rn - ro) > 0.0001) {
      fieldChanges.push(`unit price from ${ro} to ${rn}`);
    }
    if (fieldChanges.length) {
      changes[`item_changed_${++idx}`] = {
        new: `${name}: ${fieldChanges.join("; ")}`,
      };
    }
  }

  return changes;
}
