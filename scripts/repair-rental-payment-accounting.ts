/**
 * scripts/repair-rental-payment-accounting.ts
 *
 * Repairs rental payment accounting discrepancies across 6 types (A–F).
 *
 * Safe to run multiple times — uses dry-run by default.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/repair-rental-payment-accounting.ts [options]
 *
 * Options:
 *   --dry-run               (default) Shows what would be repaired — no changes.
 *   --apply --confirm=REPAIR_RENTAL_ACCOUNTING  Actually applies the repairs.
 *   --as-of     YYYY-MM-DD  The "today" date. Defaults to today UTC.
 *   --company   companyId   Only repair this company (optional; repairs all if omitted).
 *   --types     A,B,C       Comma-separated list of repair types to run (default: all).
 *
 * Repair types:
 *   A) future-dated POSTED → SCHEDULED (voucher soft-deleted, ledger reversed)
 *   B) wrong-entry shop voucher (Dr Rent Expense instead of correct accrual/advance split)
 *      — marks the voucher for review; full re-post requires manual confirm
 *   C) paid_amount cache drift vs POSTED payments sum — updates cache column
 *   D) usedPrepaidAccount / usedAdvanceAccount flag drift — updates flags from voucher entries
 *   E) orphan Accrued Rent Payable (accrual voucher with no subsequent payment) — flags for review
 *   F) SCHEDULED payments whose paymentDate has arrived — triggers posting
 */

import { Pool, PoolClient } from "pg";

const args = process.argv.slice(2);
const isDryRun = !args.includes("--apply");
const confirmToken = args.find((a) => a.startsWith("--confirm="))?.split("=")[1];
const asOfArg = args.find((a) => a.startsWith("--as-of="))?.split("=")[1];
const companyArg = args.find((a) => a.startsWith("--company="))?.split("=")[1];
const typesArg = args.find((a) => a.startsWith("--types="))?.split("=")[1];
const selectedTypes = typesArg ? typesArg.split(",").map((t) => t.trim().toUpperCase()) : ["A", "B", "C", "D", "E", "F"];

if (!isDryRun && confirmToken !== "REPAIR_RENTAL_ACCOUNTING") {
  console.error("To apply repairs, pass --apply --confirm=REPAIR_RENTAL_ACCOUNTING");
  process.exit(1);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL (or RENDER_DATABASE_URL) is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const today = asOfArg || new Date().toISOString().slice(0, 10);
  const companyFilter = companyArg ? `AND pp.company_id = ${parseInt(companyArg)}` : "";
  const mlCompanyFilter = companyArg ? `AND ml.company_id = ${parseInt(companyArg)}` : "";

  console.log(`\nRental Payment Accounting Repair`);
  console.log(`=================================`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes)" : "APPLY"}`);
  console.log(`As-of date: ${today}`);
  console.log(`Company filter: ${companyArg ?? "all"}`);
  console.log(`Repair types: ${selectedTypes.join(", ")}\n`);

  let totalRepaired = 0;

  // ── Type A: future-dated POSTED → SCHEDULED ──────────────────────────────
  if (selectedTypes.includes("A")) {
    console.log(`── Type A: Future-dated POSTED payments ──`);
    const { rows: futurePaid } = await pool.query(
      `SELECT
         pp.id, pp.company_id, pp.module, pp.contract_id, pp.unit_id,
         pp.voucher_id, pp.ledger_row_id, pp.amount, pp.payment_date,
         pp.for_year, pp.for_month, pp.posting_status, pp.payment_group_id,
         pu.unit_number, pu.location_group
       FROM property_payments pp
       LEFT JOIN property_units pu ON pu.id = pp.unit_id
       WHERE pp.payment_date > $1 AND pp.posting_status = 'POSTED' ${companyFilter}
       ORDER BY pp.company_id, pp.payment_date, pp.id`,
      [today]
    );

    if (futurePaid.length === 0) {
      console.log("  ✓ No future-dated POSTED payments found.\n");
    } else {
      const byVoucher = new Map<number | null, typeof futurePaid>();
      for (const row of futurePaid) {
        const key = row.voucher_id;
        if (!byVoucher.has(key)) byVoucher.set(key, []);
        byVoucher.get(key)!.push(row);
      }
      console.log(`  Found ${futurePaid.length} row(s) across ${byVoucher.size} voucher group(s):`);
      for (const [voucherId, rows] of byVoucher) {
        const totalAmount = rows.reduce((s, r) => s + parseFloat(r.amount), 0);
        const u = rows[0];
        const label = u.location_group ? `${u.location_group}/${u.unit_number}` : `Unit#${u.unit_id}`;
        console.log(`    Voucher #${voucherId ?? "(none)"} | Company ${u.company_id} | ${label} | $${totalAmount.toFixed(2)} on ${u.payment_date}`);
      }
      if (!isDryRun) {
        for (const [voucherId, rows] of byVoucher) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            // Reverse paid_amount cache
            for (const row of rows) {
              if (row.ledger_row_id) {
                await client.query(
                  `UPDATE property_monthly_ledger SET paid_amount = GREATEST(0, paid_amount - $1::numeric) WHERE id = $2`,
                  [row.amount, row.ledger_row_id]
                );
              }
            }
            // Soft-delete voucher if no other POSTED payments reference it
            if (voucherId) {
              const { rows: otherRef } = await client.query(
                `SELECT id FROM property_payments WHERE voucher_id = $1 AND posting_status = 'POSTED' AND payment_date <= $2 LIMIT 1`,
                [voucherId, today]
              );
              if (otherRef.length === 0) {
                await client.query(
                  `UPDATE vouchers SET deleted_at = NOW(), description = CONCAT('[VOIDED-FUTURE-PAYMENT] ', description) WHERE id = $1 AND deleted_at IS NULL`,
                  [voucherId]
                );
                await client.query(
                  `UPDATE vouchers SET deleted_at = NOW() WHERE voucher_number = $1 AND deleted_at IS NULL`,
                  [`AP-CLEAR-${voucherId}`]
                );
              }
            }
            const existingGroupId = rows.find((r) => r.payment_group_id)?.payment_group_id;
            const paymentGroupId = existingGroupId || `PG-REPAIR-A-${Date.now()}-${rows[0].contract_id}`;
            const rowIds = rows.map((r) => r.id);
            await client.query(
              `UPDATE property_payments SET posting_status = 'SCHEDULED', voucher_id = NULL, posted_at = NULL,
               payment_group_id = COALESCE(payment_group_id, $1) WHERE id = ANY($2::int[])`,
              [paymentGroupId, rowIds]
            );
            await client.query("COMMIT");
            console.log(`  ✓ Repaired voucher #${voucherId ?? "(none)"} → SCHEDULED`);
            totalRepaired++;
          } catch (e: any) {
            await client.query("ROLLBACK");
            console.error(`  ✗ Failed:`, e.message);
          } finally {
            client.release();
          }
        }
      }
    }
  }

  // ── Type B: Wrong-entry shop voucher ────────────────────────────────────
  if (selectedTypes.includes("B")) {
    console.log(`── Type B: Wrong-entry shop vouchers (Dr Rent Expense / Cr Cash — missing accrual split) ──`);
    // Detect: POSTED payments with a voucherId where the voucher has ONLY
    // 2 entries: Dr Rent Expense + Cr Cash (no Accrued Rent Payable entry).
    const { rows: wrongEntry } = await pool.query(
      `SELECT pp.id AS payment_id, pp.company_id, pp.contract_id, pp.amount, pp.voucher_id, pp.payment_date,
              v.description AS voucher_desc
       FROM property_payments pp
       JOIN vouchers v ON v.id = pp.voucher_id AND v.deleted_at IS NULL
       WHERE pp.posting_status = 'POSTED' ${companyFilter}
         AND pp.voucher_id IS NOT NULL
         AND (
           SELECT COUNT(*) FROM voucher_entries ve WHERE ve.voucher_id = pp.voucher_id
         ) = 2
         AND EXISTS (
           SELECT 1 FROM voucher_entries ve
           JOIN ledger_accounts la ON la.id = ve.ledger_account_id
           WHERE ve.voucher_id = pp.voucher_id AND la.name ILIKE '%Rent Expense%' AND ve.debit_amount::numeric > 0
         )
       ORDER BY pp.company_id, pp.payment_date, pp.id
       LIMIT 50`,
      []
    );
    if (wrongEntry.length === 0) {
      console.log("  ✓ No wrong-entry shop vouchers found.\n");
    } else {
      console.log(`  Found ${wrongEntry.length} wrong-entry voucher(s) — flagged for review:`);
      for (const r of wrongEntry) {
        console.log(`    Payment #${r.payment_id} | Voucher #${r.voucher_id} | Company ${r.company_id} | $${r.amount} on ${r.payment_date}`);
        console.log(`      Desc: ${r.voucher_desc}`);
        console.log(`      → Manual re-post recommended (run postGroupCore for this payment group)`);
      }
      if (!isDryRun) {
        // Type B repair is advisory — we add a description flag to the voucher for auditors.
        for (const r of wrongEntry) {
          await pool.query(
            `UPDATE vouchers SET description = CONCAT('[REVIEW-WRONG-ENTRY] ', description) WHERE id = $1 AND description NOT ILIKE '%REVIEW-WRONG-ENTRY%'`,
            [r.voucher_id]
          );
        }
        console.log(`  ✓ Flagged ${wrongEntry.length} voucher(s) with [REVIEW-WRONG-ENTRY] prefix`);
        totalRepaired += wrongEntry.length;
      }
    }
  }

  // ── Type C: paid_amount cache drift ──────────────────────────────────────
  if (selectedTypes.includes("C")) {
    console.log(`── Type C: paid_amount cache drift ──`);
    const { rows: driftRows } = await pool.query(
      `SELECT ml.id AS ledger_row_id, ml.contract_id, ml.year, ml.month,
              ml.paid_amount AS cached,
              COALESCE(SUM(pp.amount::numeric), 0) AS actual
       FROM property_monthly_ledger ml
       LEFT JOIN property_payments pp ON pp.ledger_row_id = ml.id AND pp.posting_status = 'POSTED'
       WHERE 1=1 ${mlCompanyFilter}
       GROUP BY ml.id, ml.contract_id, ml.year, ml.month, ml.paid_amount
       HAVING ABS(ml.paid_amount::numeric - COALESCE(SUM(pp.amount::numeric), 0)) > 0.01
       ORDER BY ml.contract_id, ml.year, ml.month`,
      []
    );
    if (driftRows.length === 0) {
      console.log("  ✓ No paid_amount cache drift found.\n");
    } else {
      console.log(`  Found ${driftRows.length} ledger row(s) with drift:`);
      for (const r of driftRows) {
        console.log(`    Row #${r.ledger_row_id} | Contract ${r.contract_id} | ${r.year}-${String(r.month).padStart(2,"0")} | cached=${Number(r.cached).toFixed(2)} actual=${Number(r.actual).toFixed(2)}`);
      }
      if (!isDryRun) {
        for (const r of driftRows) {
          await pool.query(
            `UPDATE property_monthly_ledger SET paid_amount = $1 WHERE id = $2`,
            [r.actual, r.ledger_row_id]
          );
        }
        console.log(`  ✓ Repaired ${driftRows.length} ledger row(s)`);
        totalRepaired += driftRows.length;
      }
    }
  }

  // ── Type D: usedPrepaidAccount / usedAdvanceAccount flag drift ──────────
  if (selectedTypes.includes("D")) {
    console.log(`── Type D: Flag drift (usedPrepaidAccount / usedAdvanceAccount) ──`);
    // Find ledger rows where accrual_voucher_id is set but flags are missing.
    // Try to restore flags from the voucher entries' ledger account names.
    const { rows: flagRows } = await pool.query(
      `SELECT ml.id AS ledger_row_id, ml.contract_id, ml.year, ml.month, ml.accrual_voucher_id
       FROM property_monthly_ledger ml
       WHERE 1=1 ${mlCompanyFilter}
         AND ml.accrual_voucher_id IS NOT NULL
         AND (ml.used_prepaid_account IS NULL OR ml.used_advance_account IS NULL)`,
      []
    );
    if (flagRows.length === 0) {
      console.log("  ✓ No flag drift found.\n");
    } else {
      console.log(`  Found ${flagRows.length} ledger row(s) with flag drift`);
      if (!isDryRun) {
        let fixed = 0;
        for (const r of flagRows) {
          // Look up the voucher entries to detect which accounts were used
          const { rows: entries } = await pool.query(
            `SELECT la.name, ve.debit_amount, ve.credit_amount
             FROM voucher_entries ve
             JOIN ledger_accounts la ON la.id = ve.ledger_account_id
             WHERE ve.voucher_id = $1`,
            [r.accrual_voucher_id]
          );
          const hasPrepaid = entries.some((e) => e.name?.toLowerCase().includes("prepaid rent"));
          const hasAdvance = entries.some((e) => e.name?.toLowerCase().includes("advance rent paid"));
          if (hasPrepaid || hasAdvance) {
            await pool.query(
              `UPDATE property_monthly_ledger
               SET used_prepaid_account = CASE WHEN $1 THEN accrual_voucher_id ELSE used_prepaid_account END,
                   used_advance_account = CASE WHEN $2 THEN accrual_voucher_id ELSE used_advance_account END
               WHERE id = $3`,
              [hasPrepaid, hasAdvance, r.ledger_row_id]
            );
            fixed++;
          }
        }
        console.log(`  ✓ Fixed flags on ${fixed} ledger row(s)`);
        totalRepaired += fixed;
      }
    }
  }

  // ── Type E: Orphan accruals (no subsequent POSTED payment) ──────────────
  if (selectedTypes.includes("E")) {
    console.log(`── Type E: Orphan accruals (accrual without payment) ──`);
    const { rows: orphans } = await pool.query(
      `SELECT ml.id AS ledger_row_id, ml.contract_id, ml.year, ml.month, ml.accrual_voucher_id
       FROM property_monthly_ledger ml
       WHERE 1=1 ${mlCompanyFilter}
         AND ml.accrual_voucher_id IS NOT NULL
         AND ml.paid_amount::numeric = 0
         AND NOT EXISTS (
           SELECT 1 FROM property_payments pp
           WHERE pp.ledger_row_id = ml.id AND pp.posting_status = 'POSTED'
         )
       ORDER BY ml.contract_id, ml.year, ml.month`,
      []
    );
    if (orphans.length === 0) {
      console.log("  ✓ No orphan accruals found.\n");
    } else {
      console.log(`  Found ${orphans.length} orphan accrual(s) — flagged for review:`);
      for (const r of orphans) {
        console.log(`    Row #${r.ledger_row_id} | Contract ${r.contract_id} | ${r.year}-${String(r.month).padStart(2,"0")} | AccrualVoucher #${r.accrual_voucher_id}`);
      }
      if (!isDryRun) {
        for (const r of orphans) {
          await pool.query(
            `UPDATE vouchers SET description = CONCAT('[ORPHAN-ACCRUAL] ', description)
             WHERE id = $1 AND description NOT ILIKE '%ORPHAN-ACCRUAL%'`,
            [r.accrual_voucher_id]
          );
        }
        console.log(`  ⚠ Flagged ${orphans.length} orphan accrual voucher(s) with [ORPHAN-ACCRUAL] prefix`);
        console.log(`    Manual action: either post the payment or reverse the accrual voucher.`);
        totalRepaired += orphans.length;
      }
    }
  }

  // ── Type F: SCHEDULED payments ready to post ────────────────────────────
  if (selectedTypes.includes("F")) {
    console.log(`── Type F: SCHEDULED payments ready to post ──`);
    const { rows: scheduledDue } = await pool.query(
      `SELECT pp.id, pp.company_id, pp.module, pp.contract_id, pp.amount, pp.payment_date, pp.payment_group_id
       FROM property_payments pp
       WHERE pp.payment_date <= $1 AND pp.posting_status = 'SCHEDULED' ${companyFilter}
       ORDER BY pp.company_id, pp.payment_date, pp.payment_group_id`,
      [today]
    );
    if (scheduledDue.length === 0) {
      console.log("  ✓ No overdue SCHEDULED payments found.\n");
    } else {
      // Group by paymentGroupId
      const byGroup = new Map<string, typeof scheduledDue>();
      for (const r of scheduledDue) {
        const key = r.payment_group_id ?? `PG-SINGLE-${r.id}`;
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key)!.push(r);
      }
      console.log(`  Found ${scheduledDue.length} SCHEDULED row(s) across ${byGroup.size} group(s) due on or before ${today}:`);
      for (const [groupId, rows] of byGroup) {
        const total = rows.reduce((s, r) => s + parseFloat(r.amount), 0);
        console.log(`    Group ${groupId} | Company ${rows[0].company_id} | $${total.toFixed(2)} | ${rows[0].payment_date}`);
      }
      if (!isDryRun) {
        console.log(`  ℹ Type F repair: trigger postDueScheduledRentalPayments via the app's scheduler.`);
        console.log(`    Or call: curl -X POST <APP_URL>/api/erp/rental/post-scheduled`);
        console.log(`    (Repair script does not directly invoke the posting service to avoid re-importing all server code)`);
      }
    }
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`${isDryRun ? "DRY RUN" : "APPLY"} complete. Total repaired: ${totalRepaired}`);
  if (isDryRun) console.log(`\nPass --apply --confirm=REPAIR_RENTAL_ACCOUNTING to apply.`);
  await pool.end();
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
