import type { Express } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  propertyMonthlyLedger,
  propertyContracts,
  propertyUnits,
  propertyPayments,
  vouchers,
  voucherEntries,
  interCompanyTransfers,
  ledgerAccounts,
  companies,
} from "../../shared/schema";
import { eq, and, isNull, sql, or } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(v: any): number {
  return parseFloat(v ?? "0") || 0;
}

async function findOrCreateLedgerAccount(
  companyId: number,
  name: string,
  accountType: string,
  code: string,
  subType?: string
): Promise<number> {
  const [existing] = await db
    .select()
    .from(ledgerAccounts)
    .where(
      and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name), isNull(ledgerAccounts.deletedAt))
    );
  if (existing) return existing.id;
  const [created] = await db
    .insert(ledgerAccounts)
    .values({
      companyId,
      code: `${code}-${Date.now()}`,
      name,
      accountType: accountType as any,
      subType: subType ?? null,
      active: true,
    })
    .returning();
  return created.id;
}

// ── Types shared between scan & apply ────────────────────────────────────────

export interface LedgerDrift {
  id: number;
  contractId: number;
  year: number;
  month: number;
  module: string;
  tenantName: string;
  unitLabel: string;
  storedPaid: number;
  computedPaid: number;
  diff: number;
}

export interface VoucherEntryMissing {
  paymentId: number;
  voucherId: number;
  contractId: number;
  module: string;
  tenantName: string;
  unitLabel: string;
  amount: number;
  paymentDate: string;
  cashAccountId: number | null;
  cashAccountName: string;
  unitType: string; // SHOP or WAREHOUSE
  issue: "EMPTY_VOUCHER" | "SOFT_DELETED_VOUCHER";
}

export interface OrphanedTransfer {
  transferId: number;
  description: string;
  amount: number;
  transferDate: string;
  fromCompanyName: string;
  toCompanyName: string;
  orphanedSide: "FROM" | "TO";
  orphanedVoucherId: number;
  issue: "SOFT_DELETED" | "EMPTY_ENTRIES";
}

export interface DepositFlagMismatch {
  contractId: number;
  tenantName: string;
  unitLabel: string;
  module: string;
  guaranteeAmount: number;
  voucherAmount?: number;
  flagValue: boolean;
  voucherExists: boolean;
  issue: "STALE_FLAG" | "MISSING_FLAG" | "AMOUNT_MISMATCH";
}

export interface ScanResult {
  ledgerDrifts: LedgerDrift[];
  voucherEntryMissing: VoucherEntryMissing[];
  orphanedTransfers: OrphanedTransfer[];
  depositFlagMismatches: DepositFlagMismatch[];
  totalDiscrepancies: number;
}

// Snapshot for undo
export interface ApplySnapshot {
  ledgerSnapshots: { id: number; oldPaid: number; newPaid: number }[];
  voucherEntriesAdded: number[]; // voucherEntry ids that were inserted (we delete them on undo)
  vouchersUndeleted: { id: number }[]; // vouchers that had deletedAt cleared
  orphanedVouchersDeleted: {
    id: number;
    voucherNumber: string;
    companyId: number;
    totalAmount: string;
    voucherType: string;
    voucherDate: string;
    description: string | null;
    entries: { ledgerAccountId: number | null; debitAmount: string; creditAmount: string; narration: string | null }[];
  }[];
  transfersDeleted: {
    id: number;
    transferType: string;
    fromCompanyId: number;
    toCompanyId: number;
    transferDate: string;
    amount: string;
    fromLedgerAccountId: number;
    toLedgerAccountId: number;
    fromVoucherId: number | null;
    toVoucherId: number | null;
    description: string | null;
    sourcePaymentId: number | null;
  }[];
  depositSnapshots: {
    contractId: number;
    oldFlag: boolean;
    newFlag: boolean;
    oldPostedAmount: number;
    newPostedAmount: number;
  }[];
}

export function registerBalanceRepairRoutes(app: Express) {
  // ── GET /api/admin/repair-balances/scan ──────────────────────────────────
  app.get("/api/admin/repair-balances/scan", requireAuth, requireRole("Admin"), async (req: any, res: any) => {
    try {
      const companyId: number | undefined = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // ── 1. Ledger drift: paid_amount vs sum of property_payments ─────────
      const allLedger = await db
        .select()
        .from(propertyMonthlyLedger)
        .where(eq(propertyMonthlyLedger.companyId, companyId));

      const pmtSumsRows = await db.execute(sql`
          SELECT ledger_row_id, COALESCE(SUM(amount::numeric), 0) AS total_paid
          FROM property_payments
          WHERE company_id = ${companyId} AND ledger_row_id IS NOT NULL
          GROUP BY ledger_row_id
        `);
      const pmtMap = new Map<number, number>();
      for (const row of (pmtSumsRows as any).rows ?? pmtSumsRows) {
        pmtMap.set(Number(row.ledger_row_id), parseNum(row.total_paid));
      }

      // Load contract + unit info for labels
      const contracts = await db.select().from(propertyContracts).where(eq(propertyContracts.companyId, companyId));
      const contractMap = new Map(contracts.map((c) => [c.id, c]));

      const allUnits = await db
        .select({
          id: propertyUnits.id,
          locationGroup: propertyUnits.locationGroup,
          unitNumber: propertyUnits.unitNumber,
          unitType: propertyUnits.unitType,
        })
        .from(propertyUnits)
        .where(eq(propertyUnits.companyId, companyId));
      const unitMap = new Map(allUnits.map((u) => [u.id, u]));

      const ledgerDrifts: LedgerDrift[] = [];
      for (const row of allLedger) {
        const computed = pmtMap.get(row.id) ?? 0;
        const stored = parseNum(row.paidAmount);
        const diff = Math.abs(computed - stored);
        if (diff > 0.005) {
          const contract = contractMap.get(row.contractId);
          const unit = unitMap.get(row.unitId ?? contract?.unitId ?? 0);
          ledgerDrifts.push({
            id: row.id,
            contractId: row.contractId,
            year: row.year,
            month: row.month,
            module: row.module ?? "PROPERTIES",
            tenantName: contract?.tenantName ?? `Contract #${row.contractId}`,
            unitLabel: unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${row.unitId}`,
            storedPaid: stored,
            computedPaid: computed,
            diff,
          });
        }
      }

      // ── 2. Rent voucher entry missing: payment has voucher_id but entries absent/voucher soft-deleted ──
      const paymentsWithVoucher = await db.execute(sql`
          SELECT
            pp.id          AS payment_id,
            pp.voucher_id,
            pp.contract_id,
            pp.module,
            pp.amount,
            pp.payment_date,
            pp.cash_account_id,
            pp.unit_id,
            v.deleted_at   AS voucher_deleted_at,
            (SELECT COUNT(*) FROM voucher_entries ve WHERE ve.voucher_id = pp.voucher_id) AS entry_count,
            la.name        AS cash_account_name,
            pu.unit_type
          FROM property_payments pp
          JOIN vouchers v ON v.id = pp.voucher_id
          LEFT JOIN ledger_accounts la ON la.id = pp.cash_account_id
          LEFT JOIN property_units pu ON pu.id = pp.unit_id
          WHERE pp.company_id = ${companyId}
            AND pp.voucher_id IS NOT NULL
        `);

      const voucherEntryMissing: VoucherEntryMissing[] = [];
      const seenVoucherIds = new Set<number>(); // deduplicate (split payments share one voucher)
      for (const row of (paymentsWithVoucher as any).rows ?? paymentsWithVoucher) {
        const vid = Number(row.voucher_id);
        if (seenVoucherIds.has(vid)) continue;
        const entryCount = Number(row.entry_count ?? 0);
        const isDeleted = !!row.voucher_deleted_at;
        if (entryCount === 0 || isDeleted) {
          seenVoucherIds.add(vid);
          const contract = contractMap.get(Number(row.contract_id));
          const unit = unitMap.get(Number(row.unit_id));
          voucherEntryMissing.push({
            paymentId: Number(row.payment_id),
            voucherId: vid,
            contractId: Number(row.contract_id),
            module: row.module ?? "PROPERTIES",
            tenantName: contract?.tenantName ?? `Contract #${row.contract_id}`,
            unitLabel: unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${row.unit_id}`,
            amount: parseNum(row.amount),
            paymentDate: row.payment_date,
            cashAccountId: row.cash_account_id ? Number(row.cash_account_id) : null,
            cashAccountName: row.cash_account_name ?? "(unknown account)",
            unitType: row.unit_type ?? "WAREHOUSE",
            issue: isDeleted ? "SOFT_DELETED_VOUCHER" : "EMPTY_VOUCHER",
          });
        }
      }

      // ── 3. Orphaned inter-company transfer sides ──────────────────────────
      // A transfer is orphaned if one of its vouchers is soft-deleted OR has no entries,
      // while the other side still exists and has entries.
      const transferRows = await db.execute(sql`
          SELECT
            ict.id,
            ict.description,
            ict.amount,
            ict.transfer_date,
            ict.from_company_id,
            ict.to_company_id,
            ict.from_voucher_id,
            ict.to_voucher_id,
            fc.name AS from_company_name,
            tc.name AS to_company_name,
            fv.deleted_at AS from_deleted,
            tv.deleted_at AS to_deleted,
            (SELECT COUNT(*) FROM voucher_entries ve WHERE ve.voucher_id = ict.from_voucher_id) AS from_entry_count,
            (SELECT COUNT(*) FROM voucher_entries ve WHERE ve.voucher_id = ict.to_voucher_id)   AS to_entry_count
          FROM inter_company_transfers ict
          LEFT JOIN companies fc ON fc.id = ict.from_company_id
          LEFT JOIN companies tc ON tc.id = ict.to_company_id
          LEFT JOIN vouchers fv ON fv.id = ict.from_voucher_id
          LEFT JOIN vouchers tv ON tv.id = ict.to_voucher_id
          WHERE ict.from_company_id = ${companyId} OR ict.to_company_id = ${companyId}
        `);

      const orphanedTransfers: OrphanedTransfer[] = [];
      for (const row of (transferRows as any).rows ?? transferRows) {
        const fromBroken = !!row.from_deleted || Number(row.from_entry_count ?? 0) === 0;
        const toBroken = !!row.to_deleted || Number(row.to_entry_count ?? 0) === 0;
        const fromExists = !!row.from_voucher_id;
        const toExists = !!row.to_voucher_id;

        // One side broken, the other fine = orphan
        if (fromBroken && toExists && !toBroken) {
          orphanedTransfers.push({
            transferId: Number(row.id),
            description: row.description ?? "",
            amount: parseNum(row.amount),
            transferDate: row.transfer_date,
            fromCompanyName: row.from_company_name ?? `Company #${row.from_company_id}`,
            toCompanyName: row.to_company_name ?? `Company #${row.to_company_id}`,
            orphanedSide: "FROM",
            orphanedVoucherId: Number(row.from_voucher_id),
            issue: row.from_deleted ? "SOFT_DELETED" : "EMPTY_ENTRIES",
          });
        } else if (toBroken && fromExists && !fromBroken) {
          orphanedTransfers.push({
            transferId: Number(row.id),
            description: row.description ?? "",
            amount: parseNum(row.amount),
            transferDate: row.transfer_date,
            fromCompanyName: row.from_company_name ?? `Company #${row.from_company_id}`,
            toCompanyName: row.to_company_name ?? `Company #${row.to_company_id}`,
            orphanedSide: "TO",
            orphanedVoucherId: Number(row.to_voucher_id),
            issue: row.to_deleted ? "SOFT_DELETED" : "EMPTY_ENTRIES",
          });
        }
      }

      // ── 4. Deposit flag mismatches ────────────────────────────────────────
      const guarRows = await db.execute(sql`
          SELECT voucher_number, total_amount FROM vouchers
          WHERE company_id = ${companyId} AND deleted_at IS NULL AND voucher_number LIKE 'GUAR-%'
        `);
      const guarContractIds = new Set<number>();
      const guarAmountMap = new Map<number, number>(); // contractId → voucher total_amount
      for (const row of (guarRows as any).rows ?? guarRows) {
        const parts = String(row.voucher_number ?? "").split("-");
        const cid = parseInt(parts[parts.length - 1]);
        if (!isNaN(cid)) {
          guarContractIds.add(cid);
          guarAmountMap.set(cid, parseNum(row.total_amount));
        }
      }

      const depositFlagMismatches: DepositFlagMismatch[] = [];
      for (const c of contracts) {
        const gAmt = parseNum(c.guaranteeAmount);
        const flagOn = c.guaranteePostedToStatement;
        const hasVouc = guarContractIds.has(c.id);
        const unit = unitMap.get(c.unitId);
        const postedAmt = parseNum(c.guaranteePostedAmount ?? String(gAmt));
        const voucherAmt = guarAmountMap.get(c.id) ?? 0;

        if (flagOn && !hasVouc) {
          // Flag says posted but no accounting entry exists — shows green in UI but missing from balance sheet
          depositFlagMismatches.push({
            contractId: c.id,
            tenantName: c.tenantName,
            unitLabel: unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${c.unitId}`,
            module: c.module,
            guaranteeAmount: postedAmt,
            flagValue: true,
            voucherExists: false,
            issue: "STALE_FLAG",
          });
        } else if (!flagOn && hasVouc && gAmt > 0) {
          // Voucher exists and has accounting entries, but flag is still false — UI shows unposted incorrectly
          depositFlagMismatches.push({
            contractId: c.id,
            tenantName: c.tenantName,
            unitLabel: unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${c.unitId}`,
            module: c.module,
            guaranteeAmount: gAmt,
            flagValue: false,
            voucherExists: true,
            issue: "MISSING_FLAG",
          });
        } else if (flagOn && hasVouc && Math.abs(voucherAmt - postedAmt) > 0.01) {
          // Flag and voucher both exist, but recorded amount on contract differs from actual voucher amount
          depositFlagMismatches.push({
            contractId: c.id,
            tenantName: c.tenantName,
            unitLabel: unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${c.unitId}`,
            module: c.module,
            guaranteeAmount: postedAmt,
            voucherAmount: voucherAmt,
            flagValue: true,
            voucherExists: true,
            issue: "AMOUNT_MISMATCH",
          });
        }
      }

      const result: ScanResult = {
        ledgerDrifts,
        voucherEntryMissing,
        orphanedTransfers,
        depositFlagMismatches,
        totalDiscrepancies:
          ledgerDrifts.length + voucherEntryMissing.length + orphanedTransfers.length + depositFlagMismatches.length,
      };
      res.json(result);
    } catch (err: any) {
      console.error("[BalanceRepair] scan error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/admin/repair-balances/apply ────────────────────────────────
  app.post("/api/admin/repair-balances/apply", requireAuth, requireRole("Admin"), async (req: any, res: any) => {
    try {
      const companyId: number | undefined = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const snapshot: ApplySnapshot = {
        ledgerSnapshots: [],
        voucherEntriesAdded: [],
        vouchersUndeleted: [],
        orphanedVouchersDeleted: [],
        transfersDeleted: [],
        depositSnapshots: [],
      };

      // Re-run scan to get current state
      // ── 1. Fix ledger drift ───────────────────────────────────────────────
      const allLedger = await db
        .select()
        .from(propertyMonthlyLedger)
        .where(eq(propertyMonthlyLedger.companyId, companyId));
      const pmtSumsRows = await db.execute(sql`
          SELECT ledger_row_id, COALESCE(SUM(amount::numeric), 0) AS total_paid
          FROM property_payments WHERE company_id = ${companyId} AND ledger_row_id IS NOT NULL
          GROUP BY ledger_row_id
        `);
      const pmtMap = new Map<number, number>();
      for (const row of (pmtSumsRows as any).rows ?? pmtSumsRows) {
        pmtMap.set(Number(row.ledger_row_id), parseNum(row.total_paid));
      }
      for (const row of allLedger) {
        const computed = pmtMap.get(row.id) ?? 0;
        const stored = parseNum(row.paidAmount);
        if (Math.abs(computed - stored) > 0.005) {
          snapshot.ledgerSnapshots.push({ id: row.id, oldPaid: stored, newPaid: computed });
          await db
            .update(propertyMonthlyLedger)
            .set({ paidAmount: computed.toFixed(2) })
            .where(eq(propertyMonthlyLedger.id, row.id));
        }
      }

      // ── 2. Fix missing voucher entries ────────────────────────────────────
      const contracts = await db.select().from(propertyContracts).where(eq(propertyContracts.companyId, companyId));
      const contractMap = new Map(contracts.map((c) => [c.id, c]));
      const allUnits = await db.select().from(propertyUnits).where(eq(propertyUnits.companyId, companyId));
      const unitMap = new Map(allUnits.map((u) => [u.id, u]));

      const paymentsRows = await db.execute(sql`
          SELECT
            pp.id, pp.voucher_id, pp.contract_id, pp.module, pp.amount, pp.payment_date,
            pp.cash_account_id, pp.unit_id,
            v.deleted_at AS voucher_deleted_at,
            v.total_amount AS voucher_total,
            v.voucher_type,
            v.voucher_date,
            v.description AS voucher_desc,
            (SELECT COUNT(*) FROM voucher_entries ve WHERE ve.voucher_id = pp.voucher_id) AS entry_count,
            pu.unit_type
          FROM property_payments pp
          JOIN vouchers v ON v.id = pp.voucher_id
          LEFT JOIN property_units pu ON pu.id = pp.unit_id
          WHERE pp.company_id = ${companyId} AND pp.voucher_id IS NOT NULL
        `);

      const seenVouchers = new Set<number>();
      for (const row of (paymentsRows as any).rows ?? paymentsRows) {
        const vid = Number(row.voucher_id);
        if (seenVouchers.has(vid)) continue;
        const entryCount = Number(row.entry_count ?? 0);
        const isDeleted = !!row.voucher_deleted_at;
        if (entryCount > 0 && !isDeleted) continue;
        seenVouchers.add(vid);

        const cashAccId = row.cash_account_id ? Number(row.cash_account_id) : null;
        const amount = row.voucher_total ?? row.amount;
        const isShop = (row.unit_type ?? "WAREHOUSE") === "SHOP";
        const contract = contractMap.get(Number(row.contract_id));
        const module = row.module ?? "PROPERTIES";

        // If voucher was soft-deleted, un-delete it first
        if (isDeleted) {
          snapshot.vouchersUndeleted.push({ id: vid });
          await db.execute(sql`UPDATE vouchers SET deleted_at = NULL WHERE id = ${vid}`);
        }

        // Re-insert entries only if there are none (after potential un-delete)
        const countAfter = await db.execute(sql`SELECT COUNT(*) AS cnt FROM voucher_entries WHERE voucher_id = ${vid}`);
        const cnt = Number(((countAfter as any).rows ?? countAfter)[0]?.cnt ?? 0);
        if (cnt === 0 && cashAccId) {
          const amtStr = String(amount);
          let incomeOrExpenseId: number | null = null;

          if (isShop) {
            incomeOrExpenseId = await findOrCreateLedgerAccount(
              companyId,
              "Rent Expense - Shops",
              "Indirect Expense",
              "SHOP-RENT-EXP"
            );
          } else {
            // Pick income account name matching the module
            const incomeAccName =
              module === "ERP" ? "Rent Income - ERP" : module === "FACTORY" ? "Rent Income - Factory" : "Rental Income";
            incomeOrExpenseId = await findOrCreateLedgerAccount(
              companyId,
              incomeAccName,
              "Income",
              "RENT-INC",
              "Indirect Income"
            );
          }

          const narration = row.voucher_desc ?? (isShop ? `Rent paid` : `Rent received`);
          let inserted: { id: number }[];
          if (isShop) {
            // Debit: expense, Credit: cash
            inserted = await db
              .insert(voucherEntries)
              .values([
                {
                  voucherId: vid,
                  ledgerAccountId: incomeOrExpenseId!,
                  debitAmount: amtStr,
                  creditAmount: "0",
                  narration,
                },
                { voucherId: vid, ledgerAccountId: cashAccId, debitAmount: "0", creditAmount: amtStr, narration },
              ])
              .returning({ id: voucherEntries.id });
          } else {
            // Debit: cash, Credit: income
            inserted = await db
              .insert(voucherEntries)
              .values([
                { voucherId: vid, ledgerAccountId: cashAccId, debitAmount: amtStr, creditAmount: "0", narration },
                {
                  voucherId: vid,
                  ledgerAccountId: incomeOrExpenseId!,
                  debitAmount: "0",
                  creditAmount: amtStr,
                  narration,
                },
              ])
              .returning({ id: voucherEntries.id });
          }
          snapshot.voucherEntriesAdded.push(...inserted.map((r) => r.id));
        }
      }

      // ── 3. Fix orphaned transfer sides ────────────────────────────────────
      // Delete the orphaned voucher (and its entries) and the transfer link.
      const transferRows = await db.execute(sql`
          SELECT
            ict.id, ict.transfer_type, ict.from_company_id, ict.to_company_id,
            ict.transfer_date, ict.amount, ict.from_ledger_account_id, ict.to_ledger_account_id,
            ict.from_voucher_id, ict.to_voucher_id, ict.description, ict.source_payment_id,
            fv.deleted_at AS from_deleted,
            tv.deleted_at AS to_deleted,
            (SELECT COUNT(*) FROM voucher_entries ve WHERE ve.voucher_id = ict.from_voucher_id) AS from_entry_count,
            (SELECT COUNT(*) FROM voucher_entries ve WHERE ve.voucher_id = ict.to_voucher_id)   AS to_entry_count
          FROM inter_company_transfers ict
          LEFT JOIN vouchers fv ON fv.id = ict.from_voucher_id
          LEFT JOIN vouchers tv ON tv.id = ict.to_voucher_id
          WHERE ict.from_company_id = ${companyId} OR ict.to_company_id = ${companyId}
        `);

      for (const row of (transferRows as any).rows ?? transferRows) {
        const fromBroken = !!row.from_deleted || Number(row.from_entry_count ?? 0) === 0;
        const toBroken = !!row.to_deleted || Number(row.to_entry_count ?? 0) === 0;
        const fromExists = !!row.from_voucher_id;
        const toExists = !!row.to_voucher_id;

        const isOrphaned = (fromBroken && toExists && !toBroken) || (toBroken && fromExists && !fromBroken);
        if (!isOrphaned) continue;

        // Save snapshot of the transfer record before deleting
        const transferSnap = {
          id: Number(row.id),
          transferType: row.transfer_type,
          fromCompanyId: Number(row.from_company_id),
          toCompanyId: Number(row.to_company_id),
          transferDate: row.transfer_date,
          amount: String(row.amount),
          fromLedgerAccountId: Number(row.from_ledger_account_id),
          toLedgerAccountId: Number(row.to_ledger_account_id),
          fromVoucherId: row.from_voucher_id ? Number(row.from_voucher_id) : null,
          toVoucherId: row.to_voucher_id ? Number(row.to_voucher_id) : null,
          description: row.description ?? null,
          sourcePaymentId: row.source_payment_id ? Number(row.source_payment_id) : null,
        };

        // Save the orphaned voucher's data for undo
        const orphanedVid = fromBroken ? Number(row.from_voucher_id) : Number(row.to_voucher_id);
        const [orphVoucher] = await db.select().from(vouchers).where(eq(vouchers.id, orphanedVid));
        const orphEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, orphanedVid));

        snapshot.orphanedVouchersDeleted.push({
          id: orphanedVid,
          voucherNumber: orphVoucher?.voucherNumber ?? "",
          companyId: orphVoucher?.companyId ?? 0,
          totalAmount: String(orphVoucher?.totalAmount ?? "0"),
          voucherType: orphVoucher?.voucherType ?? "Payment",
          voucherDate: String(orphVoucher?.voucherDate ?? row.transfer_date),
          description: orphVoucher?.description ?? null,
          entries: orphEntries.map((e) => ({
            ledgerAccountId: e.ledgerAccountId,
            debitAmount: String(e.debitAmount),
            creditAmount: String(e.creditAmount),
            narration: e.narration ?? null,
          })),
        });
        snapshot.transfersDeleted.push(transferSnap);

        // Delete: transfer first (FK restrict), then entries, then voucher
        await db.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, Number(row.id)));
        await db.execute(sql`DELETE FROM voucher_entries WHERE voucher_id = ${orphanedVid}`);
        await db.execute(sql`DELETE FROM vouchers WHERE id = ${orphanedVid}`);
      }

      // ── 4. Fix deposit flags ──────────────────────────────────────────────
      const guarRows2 = await db.execute(sql`
          SELECT voucher_number, total_amount FROM vouchers
          WHERE company_id = ${companyId} AND deleted_at IS NULL AND voucher_number LIKE 'GUAR-%'
        `);
      const guarContractIds2 = new Set<number>();
      const guarAmountMap2 = new Map<number, number>();
      for (const row of (guarRows2 as any).rows ?? guarRows2) {
        const parts = String(row.voucher_number ?? "").split("-");
        const cid = parseInt(parts[parts.length - 1]);
        if (!isNaN(cid)) {
          guarContractIds2.add(cid);
          guarAmountMap2.set(cid, parseNum(row.total_amount));
        }
      }
      for (const c of contracts) {
        const gAmt = parseNum(c.guaranteeAmount);
        const flagOn = c.guaranteePostedToStatement;
        const hasVouc = guarContractIds2.has(c.id);
        const postedAmt = parseNum(c.guaranteePostedAmount ?? String(gAmt));
        const voucherAmt = guarAmountMap2.get(c.id) ?? 0;

        if (flagOn && !hasVouc) {
          // Reset flag — no voucher entry exists, UI was showing green incorrectly
          snapshot.depositSnapshots.push({
            contractId: c.id,
            oldFlag: true,
            newFlag: false,
            oldPostedAmount: postedAmt,
            newPostedAmount: 0,
          });
          await db
            .update(propertyContracts)
            .set({ guaranteePostedToStatement: false, guaranteePostedAmount: "0" })
            .where(eq(propertyContracts.id, c.id));
        } else if (!flagOn && hasVouc && gAmt > 0) {
          // Set flag — voucher exists, just the contract flag was stale
          snapshot.depositSnapshots.push({
            contractId: c.id,
            oldFlag: false,
            newFlag: true,
            oldPostedAmount: 0,
            newPostedAmount: gAmt,
          });
          await db
            .update(propertyContracts)
            .set({ guaranteePostedToStatement: true, guaranteePostedAmount: String(gAmt) })
            .where(eq(propertyContracts.id, c.id));
        } else if (flagOn && hasVouc && Math.abs(voucherAmt - postedAmt) > 0.01) {
          // Sync amount on contract to match actual voucher amount
          snapshot.depositSnapshots.push({
            contractId: c.id,
            oldFlag: true,
            newFlag: true,
            oldPostedAmount: postedAmt,
            newPostedAmount: voucherAmt,
          });
          await db
            .update(propertyContracts)
            .set({ guaranteePostedAmount: String(voucherAmt) })
            .where(eq(propertyContracts.id, c.id));
        }
      }

      res.json({
        ledgerFixed: snapshot.ledgerSnapshots.length,
        voucherEntriesFixed: seenVouchers.size,
        orphansFixed: snapshot.transfersDeleted.length,
        depositsFixed: snapshot.depositSnapshots.length,
        snapshot,
      });
    } catch (err: any) {
      console.error("[BalanceRepair] apply error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/admin/repair-balances/undo ────────────────────────────────
  app.post("/api/admin/repair-balances/undo", requireAuth, requireRole("Admin"), async (req: any, res: any) => {
    try {
      const { snapshot } = req.body as { snapshot: ApplySnapshot };
      if (!snapshot) return res.status(400).json({ message: "No snapshot provided" });

      // 1. Revert ledger drift
      for (const s of snapshot.ledgerSnapshots ?? []) {
        await db
          .update(propertyMonthlyLedger)
          .set({ paidAmount: s.oldPaid.toFixed(2) })
          .where(eq(propertyMonthlyLedger.id, s.id));
      }

      // 2. Remove inserted voucher entries
      for (const entryId of snapshot.voucherEntriesAdded ?? []) {
        await db.execute(sql`DELETE FROM voucher_entries WHERE id = ${entryId}`);
      }

      // 3. Re-soft-delete vouchers that were un-deleted
      for (const v of snapshot.vouchersUndeleted ?? []) {
        await db.execute(sql`UPDATE vouchers SET deleted_at = NOW() WHERE id = ${v.id}`);
      }

      // 4. Restore deleted orphaned vouchers + their entries, then re-link transfer
      for (const ov of snapshot.orphanedVouchersDeleted ?? []) {
        // Re-insert voucher with same id (use raw SQL to preserve id)
        await db.execute(sql`
            INSERT INTO vouchers (id, company_id, voucher_number, voucher_type, voucher_date, description, total_amount)
            VALUES (${ov.id}, ${ov.companyId}, ${ov.voucherNumber}, ${ov.voucherType}, ${ov.voucherDate}::date, ${ov.description}, ${ov.totalAmount})
            ON CONFLICT (id) DO NOTHING
          `);
        for (const e of ov.entries) {
          await db.execute(sql`
              INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
              VALUES (${ov.id}, ${e.ledgerAccountId}, ${e.debitAmount}, ${e.creditAmount}, ${e.narration})
            `);
        }
      }

      // 5. Re-insert deleted inter_company_transfers rows
      for (const t of snapshot.transfersDeleted ?? []) {
        await db.execute(sql`
            INSERT INTO inter_company_transfers
              (id, transfer_type, from_company_id, to_company_id, transfer_date, amount,
               from_ledger_account_id, to_ledger_account_id, from_voucher_id, to_voucher_id,
               description, source_payment_id)
            VALUES
              (${t.id}, ${t.transferType}, ${t.fromCompanyId}, ${t.toCompanyId}, ${t.transferDate}::date, ${t.amount},
               ${t.fromLedgerAccountId}, ${t.toLedgerAccountId}, ${t.fromVoucherId}, ${t.toVoucherId},
               ${t.description}, ${t.sourcePaymentId})
            ON CONFLICT (id) DO NOTHING
          `);
      }

      // 6. Revert deposit flags
      for (const s of snapshot.depositSnapshots ?? []) {
        await db
          .update(propertyContracts)
          .set({
            guaranteePostedToStatement: s.oldFlag,
            guaranteePostedAmount: s.oldPostedAmount.toFixed(2),
          })
          .where(eq(propertyContracts.id, s.contractId));
      }

      res.json({
        ledgerRestored: (snapshot.ledgerSnapshots ?? []).length,
        entriesRemoved: (snapshot.voucherEntriesAdded ?? []).length,
        orphansRestored: (snapshot.transfersDeleted ?? []).length,
        depositsRestored: (snapshot.depositSnapshots ?? []).length,
      });
    } catch (err: any) {
      console.error("[BalanceRepair] undo error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/properties/repair/reallocate-payments/:contractId ────────────
  // Two-phase fix:
  //   Phase A (SQL, always runs): zeros out any ledger paid_amount whose sum
  //     from linked payments doesn't match — catches ghost amounts from
  //     guarantee-to-cash releases or deleted payments.
  //   Phase B (JS, runs when rent payments exist): re-allocates each rent
  //     payment to the oldest outstanding month in date order.
  app.post(
    "/api/properties/repair/reallocate-payments/:contractId",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const companyId: number | undefined = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const contractId = parseInt(req.params.contractId, 10);
        if (isNaN(contractId)) return res.status(400).json({ message: "Invalid contractId" });

        const [contract] = await db
          .select()
          .from(propertyContracts)
          .where(and(eq(propertyContracts.id, contractId), eq(propertyContracts.companyId, companyId)));
        if (!contract) return res.status(404).json({ message: "Contract not found" });

        // ── Phase A: SQL sync — ALWAYS runs first ────────────────────────────
        // Sets each ledger row's paid_amount to the exact sum of property_payments
        // that point to it (ledger_row_id = id).  Payments with ledger_row_id
        // IS NULL (guarantee-to-cash releases) are naturally excluded by the join
        // condition, so ghost amounts from those are zeroed out here.
        await db.execute(sql`
          UPDATE property_monthly_ledger
          SET paid_amount = COALESCE((
            SELECT SUM(pp.amount::numeric)
            FROM property_payments pp
            WHERE pp.ledger_row_id = property_monthly_ledger.id
          ), 0)
          WHERE contract_id = ${contractId}
        `);

        // ── Phase A2: remove orphaned prepaid rows ────────────────────────────
        // Delete ledger rows where expected_amount = 0 AND paid_amount = 0 —
        // these are empty "prepaid" rows left over after payments were deleted.
        await db
          .delete(propertyMonthlyLedger)
          .where(
            and(
              eq(propertyMonthlyLedger.contractId, contractId),
              eq(propertyMonthlyLedger.companyId, companyId),
              sql`${propertyMonthlyLedger.expectedAmount}::numeric = 0`,
              sql`${propertyMonthlyLedger.paidAmount}::numeric = 0`
            )
          );

        // ── Phase B: JS re-allocation ────────────────────────────────────────
        // Load all payments that are NOT guarantee-to-cash releases.
        // Guarantee-to-cash payments are identified by notes containing
        // "[Guarantee release]" or "[Guarantee applied]" — those must never
        // be treated as rent payments.  Regular rent payments that have
        // ledgerRowId = null (orphaned) are included so they get properly linked.
        const payments = await db
          .select()
          .from(propertyPayments)
          .where(
            and(
              eq(propertyPayments.contractId, contractId),
              eq(propertyPayments.companyId, companyId),
              sql`(${propertyPayments.notes} IS NULL OR (${propertyPayments.notes} NOT LIKE '%[Guarantee release]%' AND ${propertyPayments.notes} NOT LIKE '%[Guarantee applied]%'))`
            )
          )
          .orderBy(propertyPayments.paymentDate, propertyPayments.id);

        if (payments.length === 0) {
          return res.json({ fixed: 0, message: "Ledger amounts synced (no rent payments to reallocate)." });
        }

        const ledgerRows = await db
          .select()
          .from(propertyMonthlyLedger)
          .where(and(eq(propertyMonthlyLedger.contractId, contractId), eq(propertyMonthlyLedger.companyId, companyId)))
          .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);

        if (ledgerRows.length === 0) {
          return res.json({ fixed: 0, message: "Ledger amounts synced (no ledger rows found)." });
        }

        // Reset ledger paidAmounts to 0 in memory, then re-fill from payments
        const ledgerMap = new Map<string, { id: number; expected: number; paid: number }>();
        for (const row of ledgerRows) {
          ledgerMap.set(`${row.year}-${row.month}`, {
            id: row.id,
            expected: parseNum(row.expectedAmount),
            paid: 0,
          });
        }

        const paymentUpdates: Array<{ id: number; forYear: number; forMonth: number; ledgerRowId: number | null }> = [];

        for (const payment of payments) {
          let remaining = parseNum(payment.amount);
          let firstAlloc = true;

          while (remaining > 0.005) {
            let target: {
              key: string;
              year: number;
              month: number;
              id: number;
              expected: number;
              paid: number;
            } | null = null;
            for (const [key, row] of ledgerMap) {
              const [y, m] = key.split("-").map(Number);
              if (row.expected - row.paid > 0.005) {
                target = { key, year: y, month: m, ...row };
                break;
              }
            }
            if (!target) break;

            const chunk = Math.min(remaining, target.expected - target.paid);
            target.paid += chunk;
            remaining = Math.round((remaining - chunk) * 100) / 100;
            ledgerMap.set(target.key, target);

            if (firstAlloc) {
              paymentUpdates.push({
                id: payment.id,
                forYear: target.year,
                forMonth: target.month,
                ledgerRowId: target.id,
              });
              firstAlloc = false;
            }
          }
        }

        let fixed = 0;
        await db.transaction(async (tx) => {
          for (const [, row] of ledgerMap) {
            await tx
              .update(propertyMonthlyLedger)
              .set({ paidAmount: row.paid.toFixed(2) })
              .where(eq(propertyMonthlyLedger.id, row.id));
          }
          for (const upd of paymentUpdates) {
            const original = payments.find((p) => p.id === upd.id);
            if (
              original &&
              (Number(original.forYear) !== upd.forYear ||
                Number(original.forMonth) !== upd.forMonth ||
                original.ledgerRowId !== upd.ledgerRowId)
            ) {
              await tx
                .update(propertyPayments)
                .set({ forYear: upd.forYear, forMonth: upd.forMonth, ledgerRowId: upd.ledgerRowId })
                .where(eq(propertyPayments.id, upd.id));
              fixed++;
            }
          }
        });

        res.json({ fixed, total: payments.length, message: `Reallocated ${fixed} payment(s) to the correct months.` });
      } catch (err: any) {
        console.error("[BalanceRepair] reallocate error:", err);
        res.status(500).json({ message: err.message });
      }
    }
  );
}
