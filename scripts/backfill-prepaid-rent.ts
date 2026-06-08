/**
 * backfill-prepaid-rent.ts
 *
 * One-time backfill: marks existing property_monthly_ledger rows where the
 * tenant/landlord already paid a future month in advance as usedPrepaidAccount=true,
 * so that the accrual recognition passes will generate the correct
 * Prepaid Rent / Deferred Rent Revenue journals when the billing date arrives.
 *
 * A row qualifies when:
 *   - paidAmount >= expectedAmount  (fully paid)
 *   - accrualVoucherId IS NULL      (not yet accrued — recognition not yet done)
 *   - The (year, month) is STRICTLY in the future relative to the payment date
 *     (we use the contract's start date to approximate billingDay, but since we
 *      don't store the original payment date on the ledger row we use NOW() as the
 *      conservative boundary — any month in the future as of today is eligible)
 *
 * Usage:
 *   npx tsx scripts/backfill-prepaid-rent.ts [--dry-run]
 */

import "dotenv/config";
import { Pool } from "pg";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const now = new Date();
    const curYear  = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1;

    // Find rows that are fully paid, unaccrued, and strictly in the future
    const { rows: candidates } = await client.query<{
      id: number;
      contract_id: number;
      year: number;
      month: number;
      expected_amount: string;
      paid_amount: string;
    }>(`
      SELECT id, contract_id, year, month, expected_amount, paid_amount
      FROM property_monthly_ledger
      WHERE accrual_voucher_id IS NULL
        AND used_prepaid_account = false
        AND paid_amount::numeric >= expected_amount::numeric
        AND expected_amount::numeric > 0
        AND (
          year > $1
          OR (year = $1 AND month > $2)
        )
      ORDER BY contract_id, year, month
    `, [curYear, curMonth]);

    if (candidates.length === 0) {
      console.log("No prepaid ledger rows found to backfill.");
      return;
    }

    console.log(`Found ${candidates.length} row(s) to mark as usedPrepaidAccount=true`);
    if (dryRun) {
      for (const r of candidates) {
        console.log(`  [DRY-RUN] ledger id=${r.id} contract=${r.contract_id} ${String(r.month).padStart(2,"0")}/${r.year} paid=${r.paid_amount} expected=${r.expected_amount}`);
      }
      return;
    }

    const ids = candidates.map(r => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query(
      `UPDATE property_monthly_ledger SET used_prepaid_account = true WHERE id IN (${placeholders})`,
      ids,
    );
    console.log(`Updated ${result.rowCount} row(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
