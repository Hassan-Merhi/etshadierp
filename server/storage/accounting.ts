import { eq, and, or, isNull, asc, desc, sql, ne, ilike } from "drizzle-orm";
import { db, pool } from "../db";
import * as schema from "@shared/schema";
import { adjustInventory } from "../inventoryHelper";
import type {
  LedgerAccount,
  InsertLedgerAccount,
  BankAccount,
  InsertBankAccount,
  FixedAsset,
  InsertFixedAsset,
  Voucher,
  InsertVoucher,
  VoucherEntry,
  InsertVoucherEntry,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Ledger Accounts
// ---------------------------------------------------------------------------

export async function getAllLedgerAccounts(
  companyId: number,
  includeHidden: boolean = false
): Promise<LedgerAccount[]> {
  const conditions = [eq(schema.ledgerAccounts.companyId, companyId), isNull(schema.ledgerAccounts.deletedAt)];
  if (!includeHidden) {
    conditions.push(eq(schema.ledgerAccounts.isHidden, false));
  }
  return await db
    .select()
    .from(schema.ledgerAccounts)
    .where(and(...conditions))
    .orderBy(asc(schema.ledgerAccounts.code));
}

export async function getLedgerAccountByCode(code: string, companyId: number): Promise<LedgerAccount | undefined> {
  const [account] = await db
    .select()
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.code, code),
        eq(schema.ledgerAccounts.companyId, companyId),
        isNull(schema.ledgerAccounts.deletedAt)
      )
    );
  return account;
}

export async function getLedgerAccountByName(name: string, companyId: number): Promise<LedgerAccount | undefined> {
  const [account] = await db
    .select()
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.name, name),
        eq(schema.ledgerAccounts.companyId, companyId),
        isNull(schema.ledgerAccounts.deletedAt)
      )
    );
  return account;
}

export async function createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount> {
  // Explicitly strip id/createdAt so a caller that accidentally passes a full
  // LedgerAccount object (structural typing) never includes id in the INSERT.
  const { id: _id, createdAt: _ca, ...fields } = account as any;
  const [created] = await db
    .insert(schema.ledgerAccounts)
    .values({
      ...fields,
      code: account.code || `LA-${Date.now()}`,
    })
    .returning();
  return created;
}

export async function getOrCreateLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount> {
  const code = account.code || `LA-${Date.now()}`;

  const [existingByCode] = await db
    .select()
    .from(schema.ledgerAccounts)
    .where(and(eq(schema.ledgerAccounts.companyId, account.companyId), eq(schema.ledgerAccounts.code, code)))
    .limit(1);

  if (existingByCode) {
    if (existingByCode.deletedAt !== null) {
      const [reactivated] = await db
        .update(schema.ledgerAccounts)
        .set({ deletedAt: null, active: true })
        .where(eq(schema.ledgerAccounts.id, existingByCode.id))
        .returning();
      return reactivated;
    }
    return existingByCode;
  }

  try {
    const [created] = await db
      .insert(schema.ledgerAccounts)
      .values({
        companyId: account.companyId,
        code,
        name: account.name,
        accountType: account.accountType,
        subType: account.subType ?? null,
        parentId: account.parentId ?? null,
        openingBalance: account.openingBalance ?? "0",
        openingBalanceSide: account.openingBalanceSide ?? "Dr",
        active: account.active ?? true,
      })
      .returning();
    return created;
  } catch (insertErr: any) {
    const [byCode] = await db
      .select()
      .from(schema.ledgerAccounts)
      .where(and(eq(schema.ledgerAccounts.companyId, account.companyId), eq(schema.ledgerAccounts.code, code)))
      .limit(1);
    if (byCode) {
      if (byCode.deletedAt !== null) {
        const [reactivated] = await db
          .update(schema.ledgerAccounts)
          .set({ deletedAt: null, active: true })
          .where(eq(schema.ledgerAccounts.id, byCode.id))
          .returning();
        return reactivated;
      }
      return byCode;
    }

    const [byName] = await db
      .select()
      .from(schema.ledgerAccounts)
      .where(and(eq(schema.ledgerAccounts.companyId, account.companyId), eq(schema.ledgerAccounts.name, account.name)))
      .limit(1);
    if (byName) {
      if (byName.deletedAt !== null) {
        const [reactivated] = await db
          .update(schema.ledgerAccounts)
          .set({ deletedAt: null, active: true })
          .where(eq(schema.ledgerAccounts.id, byName.id))
          .returning();
        return reactivated;
      }
      return byName;
    }

    console.error(
      "[getOrCreateLedgerAccount] INSERT failed (code=%s) and no existing row found for companyId=%s code=%s name=%s. Original error: %s",
      insertErr.code,
      account.companyId,
      code,
      account.name,
      insertErr.message
    );
    throw insertErr;
  }
}

export async function deleteLedgerAccount(id: number): Promise<void> {
  await db
    .update(schema.ledgerAccounts)
    .set({ deletedAt: new Date(), active: false })
    .where(eq(schema.ledgerAccounts.id, id));
}

export async function getLedgerAccountById(id: number): Promise<LedgerAccount | undefined> {
  const [account] = await db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, id));
  return account;
}

export async function updateLedgerAccount(account: schema.UpdateLedgerAccount): Promise<LedgerAccount> {
  const { id, ...updates } = account;
  const [updated] = await db
    .update(schema.ledgerAccounts)
    .set(updates)
    .where(eq(schema.ledgerAccounts.id, id))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Bank Accounts
// ---------------------------------------------------------------------------

export async function getAllBankAccounts(companyId: number): Promise<BankAccount[]> {
  return await db
    .select()
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.companyId, companyId), isNull(schema.bankAccounts.deletedAt)))
    .orderBy(asc(schema.bankAccounts.code));
}

export async function getBankAccountByCode(code: string): Promise<BankAccount | undefined> {
  const [account] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.code, code));
  return account;
}

export async function getBankAccountById(id: number, companyId: number): Promise<BankAccount | undefined> {
  const [account] = await db
    .select()
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.id, id), eq(schema.bankAccounts.companyId, companyId)));
  return account;
}

export async function createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
  const [created] = await db.insert(schema.bankAccounts).values(account).returning();
  return created;
}

export async function updateBankAccount(
  id: number,
  updates: Partial<InsertBankAccount>,
  companyId: number
): Promise<BankAccount> {
  const existing = await getBankAccountById(id, companyId);
  if (!existing) {
    throw new Error("Bank account not found");
  }

  if (updates.code && updates.code !== existing.code) {
    const [duplicate] = await db
      .select()
      .from(schema.bankAccounts)
      .where(
        and(
          eq(schema.bankAccounts.code, updates.code),
          eq(schema.bankAccounts.companyId, companyId),
          ne(schema.bankAccounts.id, id)
        )
      );
    if (duplicate) {
      throw new Error("Bank account code already exists in this company");
    }
  }

  const [updated] = await db
    .update(schema.bankAccounts)
    .set(updates)
    .where(and(eq(schema.bankAccounts.id, id), eq(schema.bankAccounts.companyId, companyId)))
    .returning();
  if (!updated) {
    throw new Error("Bank account not found");
  }
  return updated;
}

export async function deleteBankAccount(id: number, companyId: number): Promise<void> {
  const existing = await getBankAccountById(id, companyId);
  if (!existing) {
    throw new Error("Bank account not found");
  }

  const entries = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.voucherEntries)
    .where(eq(schema.voucherEntries.bankAccountId, id));

  const entryCount = entries[0]?.count || 0;
  if (entryCount > 0) {
    throw new Error(`Cannot delete bank account: ${entryCount} voucher entries exist`);
  }

  await db
    .update(schema.bankAccounts)
    .set({ deletedAt: new Date(), active: false })
    .where(and(eq(schema.bankAccounts.id, id), eq(schema.bankAccounts.companyId, companyId)));
}

// ---------------------------------------------------------------------------
// Fixed Assets
// ---------------------------------------------------------------------------

export async function getAllFixedAssets(companyId: number): Promise<FixedAsset[]> {
  return await db
    .select()
    .from(schema.fixedAssets)
    .where(eq(schema.fixedAssets.companyId, companyId))
    .orderBy(asc(schema.fixedAssets.code));
}

export async function getFixedAssetByCode(code: string): Promise<FixedAsset | undefined> {
  const [asset] = await db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.code, code));
  return asset;
}

export async function createFixedAsset(asset: InsertFixedAsset): Promise<FixedAsset> {
  const [created] = await db.insert(schema.fixedAssets).values(asset).returning();
  return created;
}

// ---------------------------------------------------------------------------
// Voucher Queries
// ---------------------------------------------------------------------------

export async function getAllVouchers(companyId: number): Promise<Voucher[]> {
  return await db
    .select()
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.companyId, companyId),
        isNull(schema.vouchers.deletedAt),
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OTW-REV-%'`,
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-STOCK-%'`,
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OPNSTK-%'`
      )
    )
    .orderBy(asc(schema.vouchers.voucherNumber));
}

export async function getVoucherById(id: number): Promise<Voucher | undefined> {
  const [voucher] = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id));
  return voucher;
}

export async function getVouchersByDateRange(companyId: number, startDate: string, endDate: string): Promise<any[]> {
  const vouchers = await db
    .select()
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.companyId, companyId),
        sql`${schema.vouchers.voucherDate} >= ${startDate}`,
        sql`${schema.vouchers.voucherDate} <= ${endDate}`,
        isNull(schema.vouchers.deletedAt),
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OTW-REV-%'`,
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-STOCK-%'`,
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OPNSTK-%'`
      )
    );
  return vouchers;
}

export async function getVoucherEntriesByLedger(
  ledgerAccountId: number,
  startDate?: string,
  endDate?: string,
  companyId?: number
): Promise<any[]> {
  const params: any[] = [ledgerAccountId];
  let dateFilters = "";
  if (startDate) {
    params.push(startDate);
    dateFilters += ` AND v.voucher_date >= ${params.length}`;
  }
  if (endDate) {
    params.push(endDate);
    dateFilters += ` AND v.voucher_date <= ${params.length}`;
  }
  // Scope to a specific company when provided. Without this, cross-company
  // vouchers (e.g. ERP-side intercompany entries that post to a factory
  // ledger account) would appear in the account statement, causing a
  // discrepancy against Net Position which only looks at the owner company.
  let companyFilter = "";
  if (companyId) {
    params.push(companyId);
    companyFilter = ` AND v.company_id = ${params.length}`;
  }

  // GROUP BY voucher so that a single voucher with multiple lines all posting
  // to the same ledger account appears as ONE row (with summed debit/credit),
  // not as one row per entry line.
  const result = await pool.query(
    `SELECT
       v.id                                                        AS "voucherId",
       MIN(ve.id)                                                  AS "entryId",
       COALESCE(SUM(ve.debit_amount::numeric),  0)::text           AS "debitAmount",
       COALESCE(SUM(ve.credit_amount::numeric), 0)::text           AS "creditAmount",
       STRING_AGG(DISTINCT NULLIF(TRIM(ve.narration), ''), ' | ') AS narration,
       v.voucher_number                                            AS "voucherNumber",
       v.voucher_type                                              AS "voucherType",
       v.voucher_date                                              AS "voucherDate",
       v.description                                               AS "voucherDescription",
       v.currency
     FROM voucher_entries ve
     JOIN vouchers v ON ve.voucher_id = v.id
     WHERE ve.ledger_account_id = $1
       AND v.optional = false
       AND v.deleted_at IS NULL
       ${companyFilter}
       ${dateFilters}
     GROUP BY v.id, v.voucher_number, v.voucher_type, v.voucher_date, v.description, v.currency
     ORDER BY v.voucher_date, v.id`,
    params
  );

  return result.rows;
}

export async function getVoucherEntriesByCustomer(
  customerId: number,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const conditions = [
    eq(schema.voucherEntries.customerId, customerId),
    eq(schema.vouchers.optional, false),
    isNull(schema.vouchers.deletedAt),
  ];
  if (startDate) conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);

  return await db
    .select({
      entryId: schema.voucherEntries.id,
      voucherId: schema.voucherEntries.voucherId,
      debitAmount: schema.voucherEntries.debitAmount,
      creditAmount: schema.voucherEntries.creditAmount,
      narration: schema.voucherEntries.narration,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherType: schema.vouchers.voucherType,
      voucherDate: schema.vouchers.voucherDate,
      voucherDescription: schema.vouchers.description,
      currency: schema.vouchers.currency,
    })
    .from(schema.voucherEntries)
    .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
    .where(and(...conditions));
}

export async function getVoucherEntriesByBankAccount(
  bankAccountId: number,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const conditions = [
    eq(schema.voucherEntries.bankAccountId, bankAccountId),
    eq(schema.vouchers.optional, false),
    isNull(schema.vouchers.deletedAt),
  ];
  if (startDate) conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);

  return await db
    .select({
      entryId: schema.voucherEntries.id,
      voucherId: schema.voucherEntries.voucherId,
      debitAmount: schema.voucherEntries.debitAmount,
      creditAmount: schema.voucherEntries.creditAmount,
      narration: schema.voucherEntries.narration,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherType: schema.vouchers.voucherType,
      voucherDate: schema.vouchers.voucherDate,
      voucherDescription: schema.vouchers.description,
      currency: schema.vouchers.currency,
    })
    .from(schema.voucherEntries)
    .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
    .where(and(...conditions));
}

export async function getVoucherEntriesByFixedAsset(
  fixedAssetId: number,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const conditions = [
    eq(schema.voucherEntries.fixedAssetId, fixedAssetId),
    eq(schema.vouchers.optional, false),
    isNull(schema.vouchers.deletedAt),
  ];
  if (startDate) conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);

  return await db
    .select({
      entryId: schema.voucherEntries.id,
      voucherId: schema.voucherEntries.voucherId,
      debitAmount: schema.voucherEntries.debitAmount,
      creditAmount: schema.voucherEntries.creditAmount,
      narration: schema.voucherEntries.narration,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherType: schema.vouchers.voucherType,
      voucherDate: schema.vouchers.voucherDate,
      voucherDescription: schema.vouchers.description,
      currency: schema.vouchers.currency,
    })
    .from(schema.voucherEntries)
    .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
    .where(and(...conditions));
}

export async function getVoucherEntriesBySupplier(
  supplierId: number,
  companyId?: number,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const conditions = [
    eq(schema.voucherEntries.supplierId, supplierId),
    eq(schema.vouchers.optional, false),
    isNull(schema.vouchers.deletedAt),
  ];
  if (companyId) conditions.push(eq(schema.vouchers.companyId, companyId));
  if (startDate) conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);

  return await db
    .select({
      entryId: schema.voucherEntries.id,
      voucherId: schema.voucherEntries.voucherId,
      debitAmount: schema.voucherEntries.debitAmount,
      creditAmount: schema.voucherEntries.creditAmount,
      narration: schema.voucherEntries.narration,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherType: schema.vouchers.voucherType,
      voucherDate: schema.vouchers.voucherDate,
      voucherDescription: schema.vouchers.description,
      companyId: schema.vouchers.companyId,
      currency: schema.vouchers.currency,
    })
    .from(schema.voucherEntries)
    .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
    .where(and(...conditions))
    .orderBy(sql`${schema.vouchers.voucherDate} DESC`);
}

export async function getVoucherEntriesByEmployee(
  employeeId: number,
  companyId?: number,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const conditions = [
    eq(schema.voucherEntries.employeeId, employeeId),
    eq(schema.vouchers.optional, false),
    isNull(schema.vouchers.deletedAt),
  ];
  if (companyId) conditions.push(eq(schema.vouchers.companyId, companyId));
  if (startDate) conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);

  return await db
    .select({
      entryId: schema.voucherEntries.id,
      voucherId: schema.voucherEntries.voucherId,
      debitAmount: schema.voucherEntries.debitAmount,
      creditAmount: schema.voucherEntries.creditAmount,
      narration: schema.voucherEntries.narration,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherType: schema.vouchers.voucherType,
      voucherDate: schema.vouchers.voucherDate,
      voucherDescription: schema.vouchers.description,
      companyId: schema.vouchers.companyId,
      currency: schema.vouchers.currency,
    })
    .from(schema.voucherEntries)
    .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
    .where(and(...conditions))
    .orderBy(sql`${schema.vouchers.voucherDate} DESC`);
}

export async function createVoucher(voucher: InsertVoucher): Promise<Voucher> {
  const [created] = await db.insert(schema.vouchers).values(voucher).returning();
  return created;
}

export async function updateVoucher(id: number, updates: Partial<InsertVoucher>): Promise<Voucher> {
  const [updated] = await db.update(schema.vouchers).set(updates).where(eq(schema.vouchers.id, id)).returning();
  return updated;
}

export async function getVoucherEntriesByVoucher(voucherId: number): Promise<any[]> {
  const entries = await db
    .select({
      id: schema.voucherEntries.id,
      voucherId: schema.voucherEntries.voucherId,
      ledgerAccountId: schema.voucherEntries.ledgerAccountId,
      bankAccountId: schema.voucherEntries.bankAccountId,
      fixedAssetId: schema.voucherEntries.fixedAssetId,
      supplierId: schema.voucherEntries.supplierId,
      employeeId: schema.voucherEntries.employeeId,
      factorySupplierId: schema.voucherEntries.factorySupplierId,
      debitAmount: schema.voucherEntries.debitAmount,
      creditAmount: schema.voucherEntries.creditAmount,
      narration: schema.voucherEntries.narration,
      createdAt: schema.voucherEntries.createdAt,
      accountName: schema.ledgerAccounts.name,
      accountCode: schema.ledgerAccounts.code,
      bankAccountName: schema.bankAccounts.name,
      bankAccountCode: schema.bankAccounts.code,
      fixedAssetName: schema.fixedAssets.name,
      fixedAssetCode: schema.fixedAssets.code,
      supplierName: schema.suppliers.legalName,
      supplierCode: schema.suppliers.code,
      employeeFirstName: schema.employees.firstName,
      employeeLastName: schema.employees.lastName,
      employeeCode: schema.employees.code,
      factorySupplierName: schema.factorySuppliers.name,
      customerName: schema.customers.legalName,
      customerId: schema.voucherEntries.customerId,
    })
    .from(schema.voucherEntries)
    .leftJoin(schema.ledgerAccounts, eq(schema.voucherEntries.ledgerAccountId, schema.ledgerAccounts.id))
    .leftJoin(schema.bankAccounts, eq(schema.voucherEntries.bankAccountId, schema.bankAccounts.id))
    .leftJoin(schema.fixedAssets, eq(schema.voucherEntries.fixedAssetId, schema.fixedAssets.id))
    .leftJoin(schema.suppliers, eq(schema.voucherEntries.supplierId, schema.suppliers.id))
    .leftJoin(schema.employees, eq(schema.voucherEntries.employeeId, schema.employees.id))
    .leftJoin(schema.factorySuppliers, eq(schema.voucherEntries.factorySupplierId, schema.factorySuppliers.id))
    .leftJoin(schema.customers, eq(schema.voucherEntries.customerId, schema.customers.id))
    .where(eq(schema.voucherEntries.voucherId, voucherId));

  return entries.map((entry) => {
    const employeeName =
      entry.employeeFirstName && entry.employeeLastName ? `${entry.employeeFirstName} ${entry.employeeLastName}` : null;
    return {
      ...entry,
      accountName:
        entry.accountName ||
        entry.bankAccountName ||
        entry.fixedAssetName ||
        entry.supplierName ||
        entry.factorySupplierName ||
        employeeName ||
        entry.customerName ||
        "Unknown Account",
      accountCode:
        entry.accountCode ||
        entry.bankAccountCode ||
        entry.fixedAssetCode ||
        entry.supplierCode ||
        entry.employeeCode ||
        "-",
    };
  });
}

export async function getStockItemTransactions(
  stockItemId: number,
  companyId: number,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const conditions: any[] = [eq(schema.vouchers.companyId, companyId), eq(schema.vouchers.optional, false)];
  if (startDate) conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);

  const salesItems = await db
    .select({
      id: schema.salesItems.id,
      type: sql<string>`'sales'`.as("type"),
      voucherId: schema.salesItems.voucherId,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherDate: schema.vouchers.voucherDate,
      quantity: schema.salesItems.quantity,
      rate: schema.salesItems.sellingPrice,
      totalAmount: schema.salesItems.totalSales,
      stockItemId: schema.salesItems.stockItemId,
      notes: schema.vouchers.description,
    })
    .from(schema.salesItems)
    .leftJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
    .where(and(eq(schema.salesItems.stockItemId, stockItemId), ...conditions));

  const transferItems = await db
    .select({
      id: schema.stockTransferItems.id,
      type: sql<string>`'transfer'`.as("type"),
      voucherId: schema.stockTransferVouchers.voucherId,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherDate: schema.vouchers.voucherDate,
      quantity: schema.stockTransferItems.quantity,
      rate: schema.stockTransferItems.rate,
      totalAmount: schema.stockTransferItems.totalAmount,
      stockItemId: schema.stockTransferItems.stockItemId,
      notes: schema.stockTransferVouchers.notes,
    })
    .from(schema.stockTransferItems)
    .leftJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.transferId, schema.stockTransferVouchers.id))
    .leftJoin(schema.vouchers, eq(schema.stockTransferVouchers.voucherId, schema.vouchers.id))
    .where(and(eq(schema.stockTransferItems.stockItemId, stockItemId), ...conditions));

  const adjustmentItems = await db
    .select({
      id: schema.stockAdjustmentItems.id,
      type: sql<string>`'adjustment'`.as("type"),
      voucherId: schema.stockAdjustmentVouchers.voucherId,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherDate: schema.vouchers.voucherDate,
      quantity: schema.stockAdjustmentItems.quantity,
      rate: schema.stockAdjustmentItems.rate,
      totalAmount: schema.stockAdjustmentItems.totalAmount,
      stockItemId: schema.stockAdjustmentItems.stockItemId,
      notes: schema.stockAdjustmentVouchers.notes,
    })
    .from(schema.stockAdjustmentItems)
    .leftJoin(
      schema.stockAdjustmentVouchers,
      eq(schema.stockAdjustmentItems.adjustmentId, schema.stockAdjustmentVouchers.id)
    )
    .leftJoin(schema.vouchers, eq(schema.stockAdjustmentVouchers.voucherId, schema.vouchers.id))
    .where(and(eq(schema.stockAdjustmentItems.stockItemId, stockItemId), ...conditions));

  const allTransactions = [...salesItems, ...transferItems, ...adjustmentItems].sort((a, b) => {
    if (!a.voucherDate || !b.voucherDate) return 0;
    return new Date(b.voucherDate).getTime() - new Date(a.voucherDate).getTime();
  });

  return allTransactions;
}

// ---------------------------------------------------------------------------
// VoucherEntry CRUD
// ---------------------------------------------------------------------------

export async function createVoucherEntry(entry: InsertVoucherEntry): Promise<VoucherEntry> {
  const [created] = await db.insert(schema.voucherEntries).values(entry).returning();
  return created;
}

export async function updateVoucherEntry(id: number, updates: Partial<InsertVoucherEntry>): Promise<VoucherEntry> {
  const [updated] = await db
    .update(schema.voucherEntries)
    .set(updates)
    .where(eq(schema.voucherEntries.id, id))
    .returning();
  return updated;
}

export async function deleteVoucherEntry(id: number): Promise<void> {
  await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.id, id));
}

export async function deleteVoucher(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, id));

    if (!voucher) {
      throw new Error("Voucher not found");
    }

    if (voucher.voucherType === "Sales" && voucher.locationId) {
      const salesItemsList = await tx.select().from(schema.salesItems).where(eq(schema.salesItems.voucherId, id));

      for (const saleItem of salesItemsList) {
        const quantity = parseFloat(saleItem.quantity);
        const costPrice = parseFloat(saleItem.costPrice);
        await adjustInventory(
          tx,
          voucher.locationId,
          saleItem.stockItemId,
          quantity,
          voucher.companyId,
          costPrice,
          "Sales-Reversal",
          id
        );
      }
      await tx.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, id));
    }

    if (voucher.voucherType === "Stock Transfer") {
      const [transferVoucher] = await tx
        .select()
        .from(schema.stockTransferVouchers)
        .where(eq(schema.stockTransferVouchers.voucherId, id));

      if (transferVoucher) {
        const transferItems = await tx
          .select()
          .from(schema.stockTransferItems)
          .where(eq(schema.stockTransferItems.transferId, transferVoucher.id));

        const sourceLocationId = transferVoucher.sourceLocationId;
        const destinationLocationId = transferVoucher.destinationLocationId;

        for (const item of transferItems) {
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);

          if (!sourceLocationId)
            throw new Error(`Cannot reverse stock transfer: source location ID is missing for transfer voucher ${id}`);
          if (!destinationLocationId)
            throw new Error(
              `Cannot reverse stock transfer: destination location ID is missing for transfer voucher ${id}`
            );

          await adjustInventory(
            tx,
            sourceLocationId,
            item.stockItemId,
            quantity,
            voucher.companyId,
            rate,
            "StockTransfer-Reversal",
            id
          );
          await adjustInventory(
            tx,
            destinationLocationId,
            item.stockItemId,
            -quantity,
            voucher.companyId,
            rate,
            "StockTransfer-Reversal",
            id
          );
        }

        await tx.delete(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, transferVoucher.id));
        await tx.delete(schema.stockTransferVouchers).where(eq(schema.stockTransferVouchers.id, transferVoucher.id));
      }
    }

    if (
      voucher.voucherType === "Production" ||
      voucher.voucherType === "Consumption" ||
      voucher.voucherType === "Mixed" ||
      voucher.voucherType === "Stock Adjustment"
    ) {
      const [adjustmentVoucher] = await tx
        .select()
        .from(schema.stockAdjustmentVouchers)
        .where(eq(schema.stockAdjustmentVouchers.voucherId, id));

      if (adjustmentVoucher) {
        const adjustmentItems = await tx
          .select()
          .from(schema.stockAdjustmentItems)
          .where(eq(schema.stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

        const adjustmentType = adjustmentVoucher.adjustmentType;

        for (const item of adjustmentItems) {
          const rawQuantity = parseFloat(item.quantity);
          const quantity = Math.abs(rawQuantity);
          const rate = parseFloat(item.rate);

          const isConsumption = adjustmentType === "Consumption" || (adjustmentType === "Mixed" && rawQuantity < 0);
          const reversedQuantity = isConsumption ? quantity : -quantity;

          await adjustInventory(
            tx,
            adjustmentVoucher.locationId,
            item.stockItemId,
            reversedQuantity,
            voucher.companyId,
            rate,
            `${adjustmentType}-Reversal`,
            id
          );
        }

        await tx
          .delete(schema.stockAdjustmentItems)
          .where(eq(schema.stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));
        await tx
          .delete(schema.stockAdjustmentVouchers)
          .where(eq(schema.stockAdjustmentVouchers.id, adjustmentVoucher.id));
      }
    }

    const linkedPOs = await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.voucherId, id));

    if (linkedPOs.length > 0) {
      const containerUpdates = new Map<number, { itemsTotal: number; containerNumber: string }>();
      for (const po of linkedPOs) {
        const itemsTotal = parseFloat(po.itemsTotal || "0");
        const container = await tx
          .select()
          .from(schema.containers)
          .where(eq(schema.containers.id, po.containerId))
          .limit(1);
        const containerNumber = container.length > 0 ? container[0].containerNumber : "";
        const existing = containerUpdates.get(po.containerId) || { itemsTotal: 0, containerNumber };
        containerUpdates.set(po.containerId, { itemsTotal: existing.itemsTotal + itemsTotal, containerNumber });
        await tx.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, po.id));
      }

      await tx.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.voucherId, id));

      for (const [containerId, totals] of Array.from(containerUpdates.entries())) {
        const [container] = await tx
          .select()
          .from(schema.containers)
          .where(eq(schema.containers.id, containerId))
          .limit(1);
        if (container) {
          const chargeVouchers = await tx
            .select({ id: schema.vouchers.id })
            .from(schema.vouchers)
            .where(sql`${schema.vouchers.voucherNumber} LIKE ${"CHARGE-" + container.containerNumber + "-%"}`);
          for (const chargeVoucher of chargeVouchers) {
            await tx.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, chargeVoucher.id));
            await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, chargeVoucher.id));
          }
          const newItemsTotal = Math.max(0, parseFloat(container.itemsTotal || "0") - totals.itemsTotal);
          const newChargesTotal = 0;
          const newGrandTotal = newItemsTotal + newChargesTotal;
          const remainingPOs = await tx
            .select()
            .from(schema.purchaseOrders)
            .where(eq(schema.purchaseOrders.containerId, containerId))
            .limit(1);
          if (remainingPOs.length === 0) {
            await tx.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
            await tx.delete(schema.containers).where(eq(schema.containers.id, containerId));
          } else {
            await tx
              .update(schema.containers)
              .set({
                itemsTotal: newItemsTotal.toString(),
                chargesTotal: newChargesTotal.toString(),
                grandTotal: newGrandTotal.toString(),
              })
              .where(eq(schema.containers.id, containerId));
          }
        }
      }
    }

    await tx.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, id));
    await tx.execute(
      sql`DELETE FROM factory_daybook_entries WHERE reference_table = 'vouchers' AND reference_id = ${id}`
    );
    await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, id));
  });
}

// ---------------------------------------------------------------------------
// Fiscal Period
// ---------------------------------------------------------------------------

export async function closeFiscalPeriod(
  companyId: number,
  periodStartDate: string,
  periodEndDate: string,
  retainedEarningsAccountId: number,
  closedByUserId: string,
  notes?: string
): Promise<schema.FiscalPeriodClosure> {
  return await db.transaction(async (tx) => {
    const existingClosure = await tx
      .select()
      .from(schema.fiscalPeriodClosures)
      .where(
        and(
          eq(schema.fiscalPeriodClosures.companyId, companyId),
          eq(schema.fiscalPeriodClosures.periodEndDate, periodEndDate)
        )
      );
    if (existingClosure.length > 0) {
      throw new Error(`Fiscal period ending ${periodEndDate} has already been closed`);
    }

    const accounts = await tx
      .select()
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.companyId, companyId),
          or(eq(schema.ledgerAccounts.accountType, "Income"), eq(schema.ledgerAccounts.accountType, "Expense"))
        )
      );
    if (accounts.length === 0) throw new Error("No Income or Expense accounts found for this company");

    interface AccountBalance {
      accountId: number;
      accountCode: string;
      accountName: string;
      accountType: string;
      balance: number;
    }
    const accountBalances: AccountBalance[] = [];
    let totalIncome = 0;
    let totalExpense = 0;

    for (const account of accounts) {
      const openingBalance = parseFloat(account.openingBalance || "0");
      const openingSide = account.openingBalanceSide || "Dr";
      let balance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const entries = await tx
        .select()
        .from(schema.voucherEntries)
        .innerJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
        .where(
          and(
            eq(schema.voucherEntries.ledgerAccountId, account.id),
            sql`${schema.vouchers.voucherDate} >= ${periodStartDate}`,
            sql`${schema.vouchers.voucherDate} <= ${periodEndDate}`,
            eq(schema.vouchers.companyId, companyId),
            eq(schema.vouchers.optional, false),
            isNull(schema.vouchers.deletedAt)
          )
        );

      for (const entry of entries) {
        const debit = parseFloat(entry.voucher_entries.debitAmount || "0");
        const credit = parseFloat(entry.voucher_entries.creditAmount || "0");
        balance += debit - credit;
      }

      if (account.accountType === "Income") {
        totalIncome += -balance;
        accountBalances.push({
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.accountType,
          balance: -balance,
        });
      } else {
        totalExpense += balance;
        accountBalances.push({
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.accountType,
          balance,
        });
      }
    }

    const netIncome = totalIncome - totalExpense;
    const voucherNumber = `FISCAL-CLOSE-${periodEndDate}-${Date.now()}`;
    const [closingVoucher] = await tx
      .insert(schema.vouchers)
      .values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: periodEndDate,
        description: `Fiscal Period Close: ${periodStartDate} to ${periodEndDate}${notes ? ` - ${notes}` : ""}`,
        totalAmount: Math.abs(netIncome).toFixed(2),
        optional: false,
      })
      .returning();

    for (const account of accountBalances) {
      if (account.balance === 0) continue;
      if (account.accountType === "Income") {
        await tx.insert(schema.voucherEntries).values({
          voucherId: closingVoucher.id,
          ledgerAccountId: account.accountId,
          debitAmount: account.balance.toFixed(2),
          creditAmount: "0",
          narration: `Close ${account.accountName} for period ending ${periodEndDate}`,
        });
      } else {
        await tx.insert(schema.voucherEntries).values({
          voucherId: closingVoucher.id,
          ledgerAccountId: account.accountId,
          debitAmount: "0",
          creditAmount: account.balance.toFixed(2),
          narration: `Close ${account.accountName} for period ending ${periodEndDate}`,
        });
      }
    }

    if (netIncome !== 0) {
      if (netIncome > 0) {
        await tx.insert(schema.voucherEntries).values({
          voucherId: closingVoucher.id,
          ledgerAccountId: retainedEarningsAccountId,
          debitAmount: "0",
          creditAmount: netIncome.toFixed(2),
          narration: `Net Income for period ending ${periodEndDate}`,
        });
      } else {
        await tx.insert(schema.voucherEntries).values({
          voucherId: closingVoucher.id,
          ledgerAccountId: retainedEarningsAccountId,
          debitAmount: Math.abs(netIncome).toFixed(2),
          creditAmount: "0",
          narration: `Net Loss for period ending ${periodEndDate}`,
        });
      }
    }

    const [closure] = await tx
      .insert(schema.fiscalPeriodClosures)
      .values({
        companyId,
        periodStartDate,
        periodEndDate,
        closedByUserId,
        closingVoucherId: closingVoucher.id,
        retainedEarningsAccountId,
        totalIncome: totalIncome.toFixed(2),
        totalExpense: totalExpense.toFixed(2),
        netIncome: netIncome.toFixed(2),
        status: "CLOSED",
        notes: notes || null,
      })
      .returning();

    for (const account of accountBalances) {
      await tx
        .update(schema.ledgerAccounts)
        .set({ openingBalance: "0", openingBalanceSide: "Dr" })
        .where(eq(schema.ledgerAccounts.id, account.accountId));
    }

    return closure;
  });
}

export async function getFiscalPeriodClosures(companyId: number): Promise<schema.FiscalPeriodClosure[]> {
  return await db
    .select()
    .from(schema.fiscalPeriodClosures)
    .where(eq(schema.fiscalPeriodClosures.companyId, companyId))
    .orderBy(sql`${schema.fiscalPeriodClosures.periodEndDate} DESC`);
}

// ---------------------------------------------------------------------------
// Exchange Rates
// ---------------------------------------------------------------------------

export async function getExchangeRates(companyId: number): Promise<schema.ExchangeRate[]> {
  return await db
    .select()
    .from(schema.exchangeRates)
    .where(eq(schema.exchangeRates.companyId, companyId))
    .orderBy(sql`${schema.exchangeRates.effectiveDate} DESC`);
}

export async function getLatestExchangeRate(
  companyId: number,
  fromCurrency: string,
  toCurrency: string
): Promise<schema.ExchangeRate | undefined> {
  const results = await db
    .select()
    .from(schema.exchangeRates)
    .where(
      and(
        eq(schema.exchangeRates.companyId, companyId),
        eq(schema.exchangeRates.fromCurrency, fromCurrency),
        eq(schema.exchangeRates.toCurrency, toCurrency)
      )
    )
    .orderBy(sql`${schema.exchangeRates.effectiveDate} DESC`)
    .limit(1);
  return results[0];
}

export async function getExchangeRateForDate(
  companyId: number,
  fromCurrency: string,
  toCurrency: string,
  date: string
): Promise<schema.ExchangeRate | undefined> {
  const results = await db
    .select()
    .from(schema.exchangeRates)
    .where(
      and(
        eq(schema.exchangeRates.companyId, companyId),
        eq(schema.exchangeRates.fromCurrency, fromCurrency),
        eq(schema.exchangeRates.toCurrency, toCurrency),
        sql`${schema.exchangeRates.effectiveDate} <= ${date}`
      )
    )
    .orderBy(sql`${schema.exchangeRates.effectiveDate} DESC`)
    .limit(1);
  return results[0];
}

export async function createExchangeRate(rate: schema.InsertExchangeRate): Promise<schema.ExchangeRate> {
  const [result] = await db.insert(schema.exchangeRates).values(rate).returning();
  return result;
}

export async function getExchangeRateForExactDate(
  companyId: number,
  fromCurrency: string,
  toCurrency: string,
  date: string
): Promise<schema.ExchangeRate | undefined> {
  const [result] = await db
    .select()
    .from(schema.exchangeRates)
    .where(
      and(
        eq(schema.exchangeRates.companyId, companyId),
        eq(schema.exchangeRates.fromCurrency, fromCurrency),
        eq(schema.exchangeRates.toCurrency, toCurrency),
        eq(schema.exchangeRates.effectiveDate, date)
      )
    )
    .limit(1);
  return result;
}

/**
 * Atomically saves the company-wide rate for a given (company, date, currency pair) —
 * inserting a new row, or updating the existing one in place if it already exists.
 * Relies on the exchange_rates_company_date_pair_unique DB constraint so two concurrent
 * saves for the same day can never create duplicate rows (last write wins).
 */
export async function upsertExchangeRate(rate: schema.InsertExchangeRate): Promise<schema.ExchangeRate> {
  const [result] = await db
    .insert(schema.exchangeRates)
    .values(rate)
    .onConflictDoUpdate({
      target: [
        schema.exchangeRates.companyId,
        schema.exchangeRates.effectiveDate,
        schema.exchangeRates.fromCurrency,
        schema.exchangeRates.toCurrency,
      ],
      set: { rate: rate.rate },
    })
    .returning();
  return result;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function getAllCustomers(companyId: number, search?: string, limit?: number): Promise<schema.Customer[]> {
  const conditions: any[] = [eq(schema.customers.companyId, companyId), isNull(schema.customers.deletedAt)];
  if (search) conditions.push(ilike(schema.customers.legalName, `%${search}%`));
  let query = db
    .select()
    .from(schema.customers)
    .where(and(...conditions))
    .orderBy(schema.customers.legalName) as any;
  if (limit) query = query.limit(limit);
  return await query;
}

export async function getCustomerById(id: number): Promise<schema.Customer | undefined> {
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
  return customer;
}

export async function getCustomerByCode(code: string, companyId: number): Promise<schema.Customer | undefined> {
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.code, code), eq(schema.customers.companyId, companyId)));
  return customer;
}

export async function createCustomer(customer: schema.InsertCustomer): Promise<schema.Customer> {
  const [newCustomer] = await db
    .insert(schema.customers)
    .values(customer as any)
    .returning();
  return newCustomer;
}

export async function updateCustomer(id: number, updates: Partial<schema.InsertCustomer>): Promise<schema.Customer> {
  const [customer] = await db.update(schema.customers).set(updates).where(eq(schema.customers.id, id)).returning();
  return customer;
}

export async function deleteCustomer(id: number): Promise<void> {
  await db.update(schema.customers).set({ deletedAt: new Date(), active: false }).where(eq(schema.customers.id, id));
}

// ---------------------------------------------------------------------------
// Inter-Company Transfers
// ---------------------------------------------------------------------------

export async function getAllInterCompanyTransfers(companyId?: number): Promise<schema.InterCompanyTransfer[]> {
  if (companyId) {
    return await db
      .select()
      .from(schema.interCompanyTransfers)
      .where(
        or(
          eq(schema.interCompanyTransfers.fromCompanyId, companyId),
          eq(schema.interCompanyTransfers.toCompanyId, companyId)
        )
      )
      .orderBy(sql`${schema.interCompanyTransfers.transferDate} DESC`);
  }
  return await db
    .select()
    .from(schema.interCompanyTransfers)
    .orderBy(sql`${schema.interCompanyTransfers.transferDate} DESC`);
}

export async function getInterCompanyTransferById(id: number): Promise<schema.InterCompanyTransfer | undefined> {
  const [transfer] = await db
    .select()
    .from(schema.interCompanyTransfers)
    .where(eq(schema.interCompanyTransfers.id, id));
  return transfer;
}

export async function createInterCompanyTransfer(
  transfer: schema.InsertInterCompanyTransfer
): Promise<schema.InterCompanyTransfer> {
  const [newTransfer] = await db.insert(schema.interCompanyTransfers).values(transfer).returning();
  return newTransfer;
}

// ---------------------------------------------------------------------------
// Company Settings
// ---------------------------------------------------------------------------

export async function getCompanySettings(companyId: number): Promise<schema.CompanySettings | undefined> {
  const [settings] = await db
    .select()
    .from(schema.companySettings)
    .where(eq(schema.companySettings.companyId, companyId));
  return settings;
}

export async function upsertCompanySettings(settings: schema.InsertCompanySettings): Promise<schema.CompanySettings> {
  const existing = await getCompanySettings(settings.companyId);
  if (existing) {
    const [updated] = await db
      .update(schema.companySettings)
      .set({ ...settings, updatedAt: sql`now()` })
      .where(eq(schema.companySettings.companyId, settings.companyId))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(schema.companySettings).values(settings).returning();
    return created;
  }
}

// ---------------------------------------------------------------------------
// Customer Balance
// ---------------------------------------------------------------------------

export async function addCustomerBalanceEntry(entry: schema.InsertCustomerBalance): Promise<schema.CustomerBalance> {
  const debitAmount = entry.debitAmount || "0";
  const creditAmount = entry.creditAmount || "0";
  if (isNaN(Number(debitAmount)) || isNaN(Number(creditAmount))) {
    throw new Error("Invalid debit or credit amount");
  }

  const [latestBalance] = await db
    .select({ balance: schema.customerBalances.balance })
    .from(schema.customerBalances)
    .where(
      and(
        eq(schema.customerBalances.customerId, entry.customerId),
        eq(schema.customerBalances.companyId, entry.companyId)
      )
    )
    .orderBy(desc(schema.customerBalances.id))
    .limit(1);

  const currentBalance = latestBalance?.balance || "0";

  const [created] = await db
    .insert(schema.customerBalances)
    .values({
      ...entry,
      debitAmount,
      creditAmount,
      balance: sql`(${currentBalance}::decimal + ${debitAmount}::decimal - ${creditAmount}::decimal)`,
    })
    .returning();
  return created;
}

export async function getCustomerBalance(customerId: number, companyId: number): Promise<number> {
  const [result] = await db
    .select({
      net: sql<string>`COALESCE(SUM(CAST(${schema.customerBalances.debitAmount} AS numeric) - CAST(${schema.customerBalances.creditAmount} AS numeric)), 0)`,
    })
    .from(schema.customerBalances)
    .where(and(eq(schema.customerBalances.customerId, customerId), eq(schema.customerBalances.companyId, companyId)));
  return result ? parseFloat(result.net) : 0;
}

export async function getCustomerStatement(
  customerId: number,
  companyId: number,
  startDate?: string,
  endDate?: string
): Promise<schema.CustomerBalance[]> {
  const conditions = [
    eq(schema.customerBalances.customerId, customerId),
    eq(schema.customerBalances.companyId, companyId),
  ];
  if (startDate) conditions.push(sql`${schema.customerBalances.transactionDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.customerBalances.transactionDate} <= ${endDate}`);
  return await db
    .select()
    .from(schema.customerBalances)
    .where(and(...conditions))
    .orderBy(schema.customerBalances.transactionDate);
}

// ---------------------------------------------------------------------------
// Role Feature Permissions
// ---------------------------------------------------------------------------

export async function getRoleFeaturePermissions(companyId: number): Promise<schema.RoleFeaturePermission[]> {
  return await db
    .select()
    .from(schema.roleFeaturePermissions)
    .where(eq(schema.roleFeaturePermissions.companyId, companyId));
}

export async function getRoleFeaturePermission(
  companyId: number,
  role: string,
  featureKey: string
): Promise<schema.RoleFeaturePermission | undefined> {
  const [permission] = await db
    .select()
    .from(schema.roleFeaturePermissions)
    .where(
      and(
        eq(schema.roleFeaturePermissions.companyId, companyId),
        eq(schema.roleFeaturePermissions.role, role),
        eq(schema.roleFeaturePermissions.featureKey, featureKey)
      )
    );
  return permission;
}

export async function upsertRoleFeaturePermission(
  permission: schema.InsertRoleFeaturePermission
): Promise<schema.RoleFeaturePermission> {
  const [result] = await db
    .insert(schema.roleFeaturePermissions)
    .values(permission)
    .onConflictDoUpdate({
      target: [
        schema.roleFeaturePermissions.companyId,
        schema.roleFeaturePermissions.role,
        schema.roleFeaturePermissions.featureKey,
      ],
      set: { enabled: permission.enabled, updatedAt: new Date() },
    })
    .returning();
  return result;
}

export async function bulkUpsertRoleFeaturePermissions(
  permissions: schema.InsertRoleFeaturePermission[]
): Promise<schema.RoleFeaturePermission[]> {
  if (permissions.length === 0) return [];
  const results: schema.RoleFeaturePermission[] = [];
  for (const permission of permissions) {
    const result = await upsertRoleFeaturePermission(permission);
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// ERP User Page Access
// ---------------------------------------------------------------------------

export async function getErpUserPageAccess(companyId: number, userId: string): Promise<string[]> {
  const rows = await db
    .select({ pageKey: schema.erpUserPageAccess.pageKey })
    .from(schema.erpUserPageAccess)
    .where(and(eq(schema.erpUserPageAccess.companyId, companyId), eq(schema.erpUserPageAccess.userId, userId)));
  return rows.map((r) => r.pageKey);
}

export async function setErpUserPageAccess(companyId: number, userId: string, pageKeys: string[]): Promise<void> {
  await db
    .delete(schema.erpUserPageAccess)
    .where(and(eq(schema.erpUserPageAccess.companyId, companyId), eq(schema.erpUserPageAccess.userId, userId)));
  if (pageKeys.length > 0) {
    await db.insert(schema.erpUserPageAccess).values(pageKeys.map((pageKey) => ({ companyId, userId, pageKey })));
  }
}

export async function getErpUserHiddenCostFields(userId: string): Promise<string[]> {
  const [user] = await db
    .select({ hiddenErpCostFields: schema.users.hiddenErpCostFields })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user?.hiddenErpCostFields ?? [];
}

export async function setErpUserHiddenCostFields(userId: string, fields: string[]): Promise<void> {
  await db.update(schema.users).set({ hiddenErpCostFields: fields }).where(eq(schema.users.id, userId));
}

// ---------------------------------------------------------------------------
// System Settings + Parent Company ID cache
// ---------------------------------------------------------------------------

export async function getSystemSetting(key: string): Promise<schema.SystemSetting | undefined> {
  const [setting] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, key));
  return setting;
}

export async function setSystemSetting(key: string, value: string | null): Promise<schema.SystemSetting> {
  const existing = await getSystemSetting(key);
  if (existing) {
    const [updated] = await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: sql`now()` })
      .where(eq(schema.systemSettings.key, key))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(schema.systemSettings).values({ key, value }).returning();
    return created;
  }
}

let _parentCompanyIdCache: { value: number | null; expiresAt: number } | null = null;
const _PARENT_ID_TTL_MS = 5 * 60 * 1000;

export async function getParentCompanyId(): Promise<number | null> {
  const now = Date.now();
  if (_parentCompanyIdCache && now < _parentCompanyIdCache.expiresAt) {
    return _parentCompanyIdCache.value;
  }
  const setting = await getSystemSetting("parentCompanyId");
  const value = setting?.value ? parseInt(setting.value, 10) || null : null;
  _parentCompanyIdCache = { value, expiresAt: now + _PARENT_ID_TTL_MS };
  return value;
}

export async function setParentCompanyId(companyId: number | null): Promise<void> {
  _parentCompanyIdCache = null;
  await setSystemSetting("parentCompanyId", companyId?.toString() ?? null);
}

// ---------------------------------------------------------------------------
// Spreadsheets
// ---------------------------------------------------------------------------

export async function listSpreadsheets(
  companyId: number
): Promise<Pick<schema.Spreadsheet, "id" | "name" | "createdBy" | "updatedAt">[]> {
  return db
    .select({
      id: schema.spreadsheets.id,
      name: schema.spreadsheets.name,
      createdBy: schema.spreadsheets.createdBy,
      updatedAt: schema.spreadsheets.updatedAt,
    })
    .from(schema.spreadsheets)
    .where(eq(schema.spreadsheets.companyId, companyId))
    .orderBy(desc(schema.spreadsheets.updatedAt));
}

export async function getSpreadsheet(id: number, companyId: number): Promise<schema.Spreadsheet | undefined> {
  const [row] = await db
    .select()
    .from(schema.spreadsheets)
    .where(and(eq(schema.spreadsheets.id, id), eq(schema.spreadsheets.companyId, companyId)));
  return row;
}

export async function createSpreadsheet(
  companyId: number,
  name: string,
  data: any,
  createdBy?: string
): Promise<schema.Spreadsheet> {
  const [row] = await db
    .insert(schema.spreadsheets)
    .values({ companyId, name, data, createdBy: createdBy ?? null })
    .returning();
  return row;
}

export async function updateSpreadsheet(
  id: number,
  companyId: number,
  fields: { name?: string; data?: any }
): Promise<schema.Spreadsheet | undefined> {
  const [row] = await db
    .update(schema.spreadsheets)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(and(eq(schema.spreadsheets.id, id), eq(schema.spreadsheets.companyId, companyId)))
    .returning();
  return row;
}

export async function deleteSpreadsheet(id: number, companyId: number): Promise<void> {
  await db
    .delete(schema.spreadsheets)
    .where(and(eq(schema.spreadsheets.id, id), eq(schema.spreadsheets.companyId, companyId)));
}

// ---------------------------------------------------------------------------
// Live Spreadsheets
// ---------------------------------------------------------------------------

export async function getLiveSpreadsheets(companyId: number, activeOnly = true): Promise<schema.LiveSpreadsheet[]> {
  const conditions = [eq(schema.liveSpreadsheets.companyId, companyId)];
  if (activeOnly) conditions.push(eq(schema.liveSpreadsheets.isActive, true));
  return db
    .select()
    .from(schema.liveSpreadsheets)
    .where(and(...conditions))
    .orderBy(schema.liveSpreadsheets.name);
}

export async function getLiveSpreadsheetById(
  id: number,
  companyId: number
): Promise<schema.LiveSpreadsheet | undefined> {
  const [row] = await db
    .select()
    .from(schema.liveSpreadsheets)
    .where(and(eq(schema.liveSpreadsheets.id, id), eq(schema.liveSpreadsheets.companyId, companyId)));
  return row;
}

export async function createLiveSpreadsheet(data: schema.InsertLiveSpreadsheet): Promise<schema.LiveSpreadsheet> {
  const [row] = await db.insert(schema.liveSpreadsheets).values(data).returning();
  return row;
}

export async function updateLiveSpreadsheet(
  id: number,
  companyId: number,
  fields: Partial<schema.InsertLiveSpreadsheet>
): Promise<schema.LiveSpreadsheet | undefined> {
  const [row] = await db
    .update(schema.liveSpreadsheets)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(and(eq(schema.liveSpreadsheets.id, id), eq(schema.liveSpreadsheets.companyId, companyId)))
    .returning();
  return row;
}

export async function deleteLiveSpreadsheet(id: number, companyId: number): Promise<void> {
  await db
    .delete(schema.liveSpreadsheets)
    .where(and(eq(schema.liveSpreadsheets.id, id), eq(schema.liveSpreadsheets.companyId, companyId)));
}
