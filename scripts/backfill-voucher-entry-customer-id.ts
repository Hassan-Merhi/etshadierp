/**
 * Backfill: stamp voucher_entries.customer_id on existing rows whose
 * ledger_account_id is linked to a customer.
 *
 * This repairs historical POS credit sales (and any other voucher entries)
 * that were written before the POS routes started setting customer_id
 * alongside the receivable ledger account.
 *
 * USAGE:
 *   tsx scripts/backfill-voucher-entry-customer-id.ts            # dry-run (default)
 *   tsx scripts/backfill-voucher-entry-customer-id.ts --apply    # actually update
 *   tsx scripts/backfill-voucher-entry-customer-id.ts --apply --company 7
 *
 * Safety:
 *   - Default mode prints what WOULD change without touching the DB.
 *   - Will only update rows where customer_id IS NULL and the linked ledger
 *     unambiguously maps to exactly one customer in the same company.
 *   - Respects --company filter.
 */

import { db } from "../server/db";
import {
  customers, ledgerAccounts, voucherEntries, vouchers,
} from "../shared/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const companyArgIdx = args.indexOf("--company");
const COMPANY_ID =
  companyArgIdx >= 0 && args[companyArgIdx + 1]
    ? parseInt(args[companyArgIdx + 1])
    : null;

async function main() {
  console.log(`\n== Voucher-Entry customer_id Backfill ==`);
  console.log(`Mode:      ${APPLY ? "APPLY (will update DB)" : "DRY-RUN (read-only)"}`);
  console.log(`Company:   ${COMPANY_ID ?? "ALL"}`);
  console.log("");

  // Find every (ledgerAccountId → customerId) link.
  const linkRows = await db
    .select({
      ledgerAccountId: customers.ledgerAccountId,
      customerId: customers.id,
      customerName: customers.legalName,
      companyId: customers.companyId,
    })
    .from(customers)
    .where(
      COMPANY_ID
        ? and(
            sql`${customers.ledgerAccountId} IS NOT NULL`,
            eq(customers.companyId, COMPANY_ID),
          )
        : sql`${customers.ledgerAccountId} IS NOT NULL`,
    );

  // Detect ambiguous links (one ledger pointing at multiple customers — bad data).
  const byLedger = new Map<number, typeof linkRows>();
  for (const r of linkRows) {
    if (!r.ledgerAccountId) continue;
    const arr = byLedger.get(r.ledgerAccountId) || [];
    arr.push(r);
    byLedger.set(r.ledgerAccountId, arr);
  }

  let totalUpdated = 0;
  let totalInspected = 0;
  let totalSkippedAmbiguous = 0;

  for (const [ledgerId, links] of Array.from(byLedger.entries())) {
    if (links.length > 1) {
      console.log(
        `[skip] ledger ${ledgerId} is linked to ${links.length} customers — refusing to backfill ambiguously.`,
      );
      totalSkippedAmbiguous += links.length;
      continue;
    }
    const link = links[0];
    const targetCustomerId = link.customerId;

    // Find candidate voucher entries: same company, this ledger, customerId NULL.
    const candidates = await db
      .select({
        id: voucherEntries.id,
        voucherId: voucherEntries.voucherId,
        debit: voucherEntries.debitAmount,
        credit: voucherEntries.creditAmount,
        voucherNumber: vouchers.voucherNumber,
        voucherType: vouchers.voucherType,
        voucherDate: vouchers.voucherDate,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(
        and(
          eq(voucherEntries.ledgerAccountId, ledgerId),
          isNull(voucherEntries.customerId),
          eq(vouchers.companyId, link.companyId),
        ),
      );

    totalInspected += candidates.length;

    if (candidates.length === 0) continue;

    console.log(
      `[ledger ${ledgerId}] customer=${link.customerName} (#${targetCustomerId}) — ${candidates.length} entries to backfill`,
    );
    if (!APPLY) {
      for (const c of candidates.slice(0, 5)) {
        console.log(
          `    e#${c.id}  ${c.voucherNumber}  ${c.voucherType}  ${c.voucherDate}  Dr=${c.debit} Cr=${c.credit}`,
        );
      }
      if (candidates.length > 5) console.log(`    ... and ${candidates.length - 5} more`);
    } else {
      const ids = candidates.map((c) => c.id);
      await db
        .update(voucherEntries)
        .set({ customerId: targetCustomerId })
        .where(inArray(voucherEntries.id, ids));
      totalUpdated += candidates.length;
      console.log(`    updated ${candidates.length} rows.`);
    }
  }

  console.log("");
  console.log(`Inspected:           ${totalInspected}`);
  console.log(`Skipped (ambiguous): ${totalSkippedAmbiguous}`);
  console.log(`Updated:             ${APPLY ? totalUpdated : 0}`);
  console.log(`Mode:                ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("");
  if (!APPLY) {
    console.log(`Re-run with --apply to commit changes.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
