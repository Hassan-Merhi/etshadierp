/**
 * scripts/repair-rental-payment-accounting.ts
 *
 * Repairs rental payment accounting for future-dated payments that were
 * incorrectly posted immediately instead of being held as SCHEDULED.
 *
 * Safe to run multiple times — uses dry-run by default.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/repair-rental-payment-accounting.ts [--dry-run] [--apply --confirm=REPAIR_RENTAL_ACCOUNTING]
 *
 * Options:
 *   --dry-run   (default) Shows what would be repaired without making any changes.
 *   --apply     --confirm=REPAIR_RENTAL_ACCOUNTING  Actually applies the repairs.
 *   --as-of     YYYY-MM-DD  The "today" date to use for determining future payments.
 *               Defaults to today UTC.
 *   --company   companyId   Only repair this company (optional, repairs all if omitted).
 */

import { Pool } from "pg";

const args = process.argv.slice(2);
const isDryRun = !args.includes("--apply");
const confirmToken = args.find((a) => a.startsWith("--confirm="))?.split("=")[1];
const asOfArg = args.find((a) => a.startsWith("--as-of="))?.split("=")[1];
const companyArg = args.find((a) => a.startsWith("--company="))?.split("=")[1];

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

  // Determine as-of date
  const today = asOfArg || new Date().toISOString().slice(0, 10);
  console.log(`\nRental Payment Accounting Repair`);
  console.log(`=================================`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes)" : "APPLY"}`);
  console.log(`As-of date: ${today}`);
  console.log(`Company filter: ${companyArg ?? "all"}\n`);

  // Find all POSTED payment rows with paymentDate > today
  // These should have been SCHEDULED, not immediately posted.
  const futurePaidQuery = `
    SELECT
      pp.id,
      pp.company_id,
      pp.module,
      pp.contract_id,
      pp.unit_id,
      pp.voucher_id,
      pp.ledger_row_id,
      pp.amount,
      pp.payment_date,
      pp.for_year,
      pp.for_month,
      pp.posting_status,
      pp.payment_group_id,
      pu.unit_number,
      pu.location_group
    FROM property_payments pp
    LEFT JOIN property_units pu ON pu.id = pp.unit_id
    WHERE pp.payment_date > $1
      AND pp.posting_status = 'POSTED'
      ${companyArg ? `AND pp.company_id = ${parseInt(companyArg)}` : ""}
    ORDER BY pp.company_id, pp.payment_date, pp.id
  `;
  const { rows: futurePaid } = await pool.query(futurePaidQuery, [today]);

  if (futurePaid.length === 0) {
    console.log("✓ No future-dated POSTED payments found — nothing to repair.");
    await pool.end();
    return;
  }

  // Group by voucherId to understand scope
  const byVoucher = new Map<number | null, typeof futurePaid>();
  for (const row of futurePaid) {
    const key = row.voucher_id;
    if (!byVoucher.has(key)) byVoucher.set(key, []);
    byVoucher.get(key)!.push(row);
  }

  console.log(`Found ${futurePaid.length} future-dated POSTED payment row(s) across ${byVoucher.size} voucher group(s):\n`);

  for (const [voucherId, rows] of byVoucher) {
    const totalAmount = rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const unit = rows[0];
    const label = unit.location_group ? `${unit.location_group}/${unit.unit_number}` : `Unit#${unit.unit_id}`;
    const periods = rows.map((r) => `${String(r.for_month).padStart(2, "0")}/${r.for_year}`).join(", ");
    console.log(`  Voucher #${voucherId ?? "(none)"} | Company ${unit.company_id} | ${label}`);
    console.log(`    Payment date: ${unit.payment_date} | Total: $${totalAmount.toFixed(2)} | Periods: ${periods}`);
    console.log(`    → Will be set to SCHEDULED (voucher soft-deleted, ledger paid_amount reversed)`);
    console.log();
  }

  if (isDryRun) {
    console.log("DRY RUN complete. Pass --apply --confirm=REPAIR_RENTAL_ACCOUNTING to apply.");
    await pool.end();
    return;
  }

  // APPLY MODE
  console.log("\nApplying repairs...\n");
  let repaired = 0;

  for (const [voucherId, rows] of byVoucher) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Reverse ledger paid_amount for each row
      for (const row of rows) {
        if (row.ledger_row_id) {
          await client.query(
            `UPDATE property_monthly_ledger
             SET paid_amount = GREATEST(0, paid_amount - $1::numeric)
             WHERE id = $2`,
            [row.amount, row.ledger_row_id]
          );
        }
      }

      // 2. Soft-delete the voucher (if any and if no other non-future payment references it)
      if (voucherId) {
        // Check if any POSTED (non-future-dated) payment references this voucher
        const { rows: otherRef } = await client.query(
          `SELECT id FROM property_payments
           WHERE voucher_id = $1 AND posting_status = 'POSTED' AND payment_date <= $2
           LIMIT 1`,
          [voucherId, today]
        );
        if (otherRef.length === 0) {
          await client.query(
            `UPDATE vouchers SET deleted_at = NOW(), description = CONCAT('[VOIDED-FUTURE-PAYMENT] ', description)
             WHERE id = $1 AND deleted_at IS NULL`,
            [voucherId]
          );
          // Also soft-delete the AP-CLEAR auto-clearing journal if any
          await client.query(
            `UPDATE vouchers SET deleted_at = NOW()
             WHERE voucher_number = $1 AND deleted_at IS NULL`,
            [`AP-CLEAR-${voucherId}`]
          );
          // Reverse auto-transfers linked to any of these payments
          for (const row of rows) {
            const { rows: transfers } = await client.query(
              `SELECT id, from_voucher_id, to_voucher_id FROM inter_company_transfers
               WHERE source_payment_id = $1`,
              [row.id]
            );
            for (const t of transfers) {
              await client.query(`DELETE FROM inter_company_transfers WHERE id = $1`, [t.id]);
              if (t.from_voucher_id) {
                await client.query(`UPDATE vouchers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [t.from_voucher_id]);
              }
              if (t.to_voucher_id) {
                await client.query(`UPDATE vouchers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [t.to_voucher_id]);
              }
            }
          }
        }
      }

      // 3. Generate a new paymentGroupId for these rows if they don't already have one
      const existingGroupId = rows.find((r) => r.payment_group_id)?.payment_group_id;
      const paymentGroupId =
        existingGroupId ||
        `PG-REPAIR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${rows[0].contract_id}`;

      // 4. Set all rows to SCHEDULED, clear voucherId and postedAt
      const rowIds = rows.map((r) => r.id);
      await client.query(
        `UPDATE property_payments
         SET posting_status = 'SCHEDULED',
             voucher_id = NULL,
             posted_at = NULL,
             payment_group_id = COALESCE(payment_group_id, $1)
         WHERE id = ANY($2::int[])`,
        [paymentGroupId, rowIds]
      );

      await client.query("COMMIT");
      const totalAmount = rows.reduce((s, r) => s + parseFloat(r.amount), 0);
      console.log(
        `  ✓ Repaired ${rows.length} row(s), total $${totalAmount.toFixed(2)}, payment_date ${rows[0].payment_date} → SCHEDULED (group: ${paymentGroupId})`
      );
      repaired++;
    } catch (e: any) {
      await client.query("ROLLBACK");
      console.error(`  ✗ Failed to repair voucher #${voucherId}:`, e.message);
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. Repaired ${repaired}/${byVoucher.size} voucher group(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
