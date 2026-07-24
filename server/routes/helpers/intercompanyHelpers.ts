import { db } from "../../db";
import { logger } from "../../lib/logger";
import {
  intercompanyPosConfigs,
  companies,
  ledgerAccounts,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { eq, and, sql, ilike, isNull } from "drizzle-orm";

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
      logger.warn(
        `[IntercompanyPOS] Could not find cash account "${cashName}" in company ${config.destCompanyId}. Dest voucher skipped.`
      );
    }
  } catch (err: any) {
    logger.error("[IntercompanyPOS] Auto-transfer failed:", { error: err?.message ?? err });
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
    logger.error("[IntercompanyPOS Recalc] Error:", { error: err?.message ?? err });
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
