#!/usr/bin/env node
/**
 * scripts/backfill-voucher-entry-currency-amounts.mjs
 *
 * Phase 14 — Historical Repair Tool
 *
 * Backfills dual-currency fields on voucher_entries rows that predate the
 * Phase 1 multi-currency schema change.
 *
 * SAFETY PROPERTIES
 * ─────────────────
 * • Dry-run by default. Pass --apply to persist changes.
 * • Requires --company <id> (or --all-companies) — never operates globally by accident.
 * • Requires --confirm <token> when --apply is set (token printed during dry-run).
 * • In apply mode: re-scans the DB, regenerates the token, and does a constant-time
 *   comparison (crypto.timingSafeEqual). Refuses to proceed on any mismatch.
 * • Company scope embedded in the token — wrong --company fails validation.
 * • Transaction-wrapped: all rows for one company either succeed or roll back together.
 * • Advisory lock per company prevents concurrent repair runs.
 * • Idempotent: rows with transaction_currency already set are skipped unconditionally.
 * • Never overwrites a non-null transaction_currency.
 * • Never uses the latest company exchange rate — only the rate stored on the voucher row.
 * • No automatic execution on startup or during migration.
 * • Uses decimal.js for all monetary arithmetic — no parseFloat multiplication.
 *
 * CLASSIFICATION GROUPS
 * ─────────────────────
 * already-repaired          transaction_currency is already populated → skip
 * identity-usd              voucher.currency is USD → transaction = existing debit/credit
 * confirmed-base-stored     stored amounts are clearly USD base → derive CFA transaction
 * confirmed-transaction-stored  stored amounts are clearly CFA → derive USD base
 * ambiguous                 scale is in the middle — manual review required
 * missing-rate              non-USD voucher with null/empty exchange_rate → manual review
 * invalid-rate              non-USD voucher with zero/negative/non-numeric rate → manual review
 *
 * CURRENCY CODE
 * ─────────────
 * This script always writes "CFA" (project identifier), never "XOF" (ISO 4217).
 * Incoming "XOF" values from the voucher table are normalised to "CFA".
 *
 * USAGE
 * ─────
 * # Dry run for one company (prints report + confirmation token)
 * node scripts/backfill-voucher-entry-currency-amounts.mjs --company 12
 *
 * # Dry run for all companies
 * node scripts/backfill-voucher-entry-currency-amounts.mjs --all-companies
 *
 * # Apply for one company (use the token printed during dry run)
 * node scripts/backfill-voucher-entry-currency-amounts.mjs --company 12 --apply --confirm <token>
 *
 * # Write diagnostic CSV
 * node scripts/backfill-voucher-entry-currency-amounts.mjs --company 12 --csv report.csv
 */

import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";

// ─── Decimal.js configuration ────────────────────────────────────────────────
// Use higher precision for intermediate calculations; output to 6 or 10 dp.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const companyArg = getArg("--company");
const allCompanies = hasFlag("--all-companies");
const apply = hasFlag("--apply");
const confirmToken = getArg("--confirm");
const csvOut = getArg("--csv");

if (!companyArg && !allCompanies) {
  console.error("ERROR: Provide --company <id> or --all-companies");
  process.exit(1);
}

if (apply && !confirmToken) {
  console.error("ERROR: --apply requires --confirm <token>. Run without --apply first to get the token.");
  process.exit(1);
}

// ─── DB connection ───────────────────────────────────────────────────────────

const connectionString = process.env.RENDER_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: Set RENDER_DATABASE_URL or DATABASE_URL environment variable.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 3 });

// ─── Currency code normalisation ──────────────────────────────────────────────

/**
 * Normalise a voucher.currency value to the project code.
 * ISO XOF → project CFA. Never map CFA → XOF.
 */
function normalizeCcy(raw) {
  const upper = (raw || "USD").trim().toUpperCase();
  if (upper === "XOF") return "CFA";
  return upper;
}

// ─── Rate helpers ─────────────────────────────────────────────────────────────

function isValidPositiveRate(val) {
  if (val === null || val === undefined || val === "") return false;
  try {
    const d = new Decimal(val);
    return d.isFinite() && d.gt(0);
  } catch {
    return false;
  }
}

function toDecimalRate(val, fallback) {
  try {
    const d = new Decimal(val);
    if (d.isFinite() && d.gt(0)) return d;
  } catch {
    /* ignore */
  }
  return fallback !== undefined ? new Decimal(fallback) : null;
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classify a voucher_entries row.
 *
 * Classification logic for CFA/USD (rate > 100 = CFA per USD):
 *   - Amounts clearly USD scale (<= 999):    confirmed-base-stored
 *   - Amounts clearly CFA scale (>= 50,000): confirmed-transaction-stored
 *   - Between 1,000 and 49,999:              ambiguous → manual review
 *
 * Only confirmed-base-stored and confirmed-transaction-stored are auto-repaired.
 * Ambiguous rows require manual review before repair.
 */
function classifyRow(voucher, entry) {
  if (entry.transaction_currency) {
    return { cls: "already-repaired", reason: "transaction_currency already populated" };
  }

  const ccy = normalizeCcy(voucher.currency);

  if (ccy === "USD") {
    return { cls: "identity-usd", reason: "voucher currency is USD; transaction = stored amounts" };
  }

  const rate = voucher.exchange_rate;
  if (rate === null || rate === undefined || rate === "") {
    return { cls: "missing-rate", reason: "voucher exchange_rate is null/empty — cannot derive amounts" };
  }

  const rateDecimal = toDecimalRate(rate, null);
  if (!rateDecimal) {
    return { cls: "invalid-rate", reason: `exchange_rate "${rate}" is not a valid number` };
  }
  if (!rateDecimal.isFinite() || rateDecimal.lte(0)) {
    return { cls: "invalid-rate", reason: `exchange_rate "${rate}" is not positive` };
  }

  let storedDebit;
  let storedCredit;
  try {
    storedDebit = new Decimal(entry.debit_amount || "0");
    storedCredit = new Decimal(entry.credit_amount || "0");
  } catch {
    return { cls: "ambiguous", reason: "could not parse stored debit/credit amounts" };
  }

  const storedMain = storedDebit.gt(0) ? storedDebit : storedCredit;

  if (rateDecimal.gt(100)) {
    // CFA-per-USD scenario (e.g. rate = 550–700)
    if (storedMain.lte(999)) {
      // Amounts this small are almost certainly USD (base-stored)
      const impliedTx = storedMain.times(rateDecimal);
      return {
        cls: "confirmed-base-stored",
        reason: `USD-scale amount ${storedMain.toFixed(2)} at rate ${rateDecimal.toFixed(2)}; CFA tx ≈ ${impliedTx.toFixed(0)}`,
      };
    }
    if (storedMain.gte(50000)) {
      // Amounts this large are almost certainly CFA (transaction-stored)
      const impliedBase = storedMain.div(rateDecimal);
      return {
        cls: "confirmed-transaction-stored",
        reason: `CFA-scale amount ${storedMain.toFixed(0)} at rate ${rateDecimal.toFixed(2)}; USD base ≈ ${impliedBase.toFixed(2)}`,
      };
    }
    // Mid-range: ambiguous
    return {
      cls: "ambiguous",
      reason: `amount ${storedMain.toFixed(2)} is in the ambiguous range for rate ${rateDecimal.toFixed(2)} — manual review required`,
    };
  }

  // Low rate (< 100): non-CFA foreign currency — only auto-classify clearly small amounts
  if (storedMain.lte(100)) {
    return {
      cls: "confirmed-base-stored",
      reason: `small amount ${storedMain.toFixed(4)} with rate ${rateDecimal.toFixed(6)}`,
    };
  }
  return {
    cls: "ambiguous",
    reason: `rate ${rateDecimal.toFixed(6)} and amount ${storedMain.toFixed(2)} are in the ambiguous range — manual review required`,
  };
}

// ─── Repair computation ───────────────────────────────────────────────────────

/**
 * Compute the dual-currency field values for a repairable row.
 * Returns null for un-repairable classifications (ambiguous, missing-rate, etc.).
 *
 * NOTE for confirmed-transaction-stored rows:
 *   The existing debit_amount / credit_amount columns are NOT changed by this script.
 *   Only the new dual-currency columns are populated.  Setting base_debit_amount and
 *   base_credit_amount here enables correct historical-base reporting without altering
 *   the existing stored transaction amounts.
 */
function computeRepair(voucher, entry, cls) {
  const txCcy = normalizeCcy(voucher.currency);

  let rateDecimal;
  try {
    rateDecimal = toDecimalRate(voucher.exchange_rate, null);
    if (!rateDecimal) rateDecimal = new Decimal("1");
  } catch {
    rateDecimal = new Decimal("1");
  }

  let baseDebit;
  let baseCredit;
  try {
    baseDebit = new Decimal(entry.debit_amount || "0");
    baseCredit = new Decimal(entry.credit_amount || "0");
  } catch {
    return null;
  }

  if (cls === "identity-usd") {
    const dStr = baseDebit.toDecimalPlaces(6).toFixed(6);
    const cStr = baseCredit.toDecimalPlaces(6).toFixed(6);
    return {
      transaction_currency: "USD",
      transaction_debit_amount: dStr,
      transaction_credit_amount: cStr,
      base_debit_amount: dStr,
      base_credit_amount: cStr,
      historical_exchange_rate: "1.0000000000",
      rate_convention: "IDENTITY",
    };
  }

  if (cls === "confirmed-base-stored") {
    // Stored amounts are USD base; derive CFA transaction amounts by multiplying
    const txDebit = baseDebit.times(rateDecimal);
    const txCredit = baseCredit.times(rateDecimal);
    return {
      transaction_currency: txCcy,
      transaction_debit_amount: txDebit.toDecimalPlaces(6).toFixed(6),
      transaction_credit_amount: txCredit.toDecimalPlaces(6).toFixed(6),
      base_debit_amount: baseDebit.toDecimalPlaces(6).toFixed(6),
      base_credit_amount: baseCredit.toDecimalPlaces(6).toFixed(6),
      historical_exchange_rate: rateDecimal.toDecimalPlaces(10).toFixed(10),
      rate_convention: "TRANSACTION_PER_BASE",
    };
  }

  if (cls === "confirmed-transaction-stored") {
    // Stored amounts ARE the CFA transaction amounts; derive USD base by dividing.
    // The existing debit_amount / credit_amount columns are NOT overwritten —
    // only the new dual-currency columns get values.
    const txDebit = baseDebit; // reuse variable name; these are the CFA amounts
    const txCredit = baseCredit;
    const derivedBaseDebit = txDebit.div(rateDecimal);
    const derivedBaseCredit = txCredit.div(rateDecimal);
    return {
      transaction_currency: txCcy,
      transaction_debit_amount: txDebit.toDecimalPlaces(6).toFixed(6),
      transaction_credit_amount: txCredit.toDecimalPlaces(6).toFixed(6),
      base_debit_amount: derivedBaseDebit.toDecimalPlaces(6).toFixed(6),
      base_credit_amount: derivedBaseCredit.toDecimalPlaces(6).toFixed(6),
      historical_exchange_rate: rateDecimal.toDecimalPlaces(10).toFixed(10),
      rate_convention: "TRANSACTION_PER_BASE",
    };
  }

  return null; // not automatically repairable
}

// ─── Core scan (read-only, no lock) ──────────────────────────────────────────

/**
 * Read-only classification scan — used both for the dry-run report and
 * for token pre-validation before apply.
 */
async function scanCompany(client, companyId) {
  const { rows: entries } = await client.query(
    `SELECT
       ve.id,
       ve.voucher_id,
       ve.debit_amount,
       ve.credit_amount,
       ve.transaction_currency,
       v.currency,
       v.exchange_rate,
       v.total_amount,
       v.voucher_type,
       v.source_module,
       v.voucher_number
     FROM voucher_entries ve
     JOIN vouchers v ON v.id = ve.voucher_id
     WHERE v.company_id = $1
     ORDER BY ve.id`,
    [companyId]
  );

  const report = [];
  for (const e of entries) {
    const voucherProxy = {
      currency: e.currency,
      exchange_rate: e.exchange_rate,
      total_amount: e.total_amount,
    };
    const { cls, reason } = classifyRow(voucherProxy, e);
    const repair = computeRepair(voucherProxy, e, cls);
    const repairable = repair !== null && cls !== "already-repaired";

    report.push({
      company_id: companyId,
      entry_id: e.id,
      voucher_id: e.voucher_id,
      voucher_number: e.voucher_number,
      voucher_type: e.voucher_type,
      source_module: e.source_module,
      currency: e.currency,
      stored_rate: e.exchange_rate,
      current_debit: e.debit_amount,
      current_credit: e.credit_amount,
      proposed_tx_debit: repair?.transaction_debit_amount ?? null,
      proposed_tx_credit: repair?.transaction_credit_amount ?? null,
      proposed_base_debit: repair?.base_debit_amount ?? null,
      proposed_base_credit: repair?.base_credit_amount ?? null,
      classification: cls,
      reason,
      repairable,
    });
  }

  return report;
}

// ─── Apply repairs ────────────────────────────────────────────────────────────

async function applyRepairs(client, companyId, report) {
  // Advisory lock prevents concurrent repair of the same company
  const lockId = 9_000_000 + companyId;
  await client.query("SELECT pg_advisory_xact_lock($1)", [lockId]);

  const toRepair = [];
  for (const r of report) {
    if (r.repairable) {
      const voucherProxy = { currency: r.currency, exchange_rate: r.stored_rate, total_amount: null };
      const entryProxy = { debit_amount: r.current_debit, credit_amount: r.current_credit, transaction_currency: null };
      const repair = computeRepair(voucherProxy, entryProxy, r.classification);
      if (repair) toRepair.push({ id: r.entry_id, repair });
    }
  }

  let applied = 0;
  for (const { id, repair } of toRepair) {
    const result = await client.query(
      `UPDATE voucher_entries SET
         transaction_currency      = $2,
         transaction_debit_amount  = $3,
         transaction_credit_amount = $4,
         base_debit_amount         = $5,
         base_credit_amount        = $6,
         historical_exchange_rate  = $7,
         rate_convention           = $8
       WHERE id = $1
         AND transaction_currency IS NULL`,  // idempotency guard
      [
        id,
        repair.transaction_currency,
        repair.transaction_debit_amount,
        repair.transaction_credit_amount,
        repair.base_debit_amount,
        repair.base_credit_amount,
        repair.historical_exchange_rate,
        repair.rate_convention,
      ]
    );
    if (result.rowCount > 0) applied++;
  }

  return { attempted: toRepair.length, applied };
}

// ─── Confirmation token ───────────────────────────────────────────────────────

function buildReportHash(reports) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(reports.map((r) => `${r.entry_id}:${r.classification}`)))
    .digest("hex")
    .slice(0, 16);
}

function generateToken(companyIds, reportHash) {
  return crypto
    .createHash("sha256")
    .update(`backfill-v1:${companyIds.join(",")}:${reportHash}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Constant-time comparison of two ASCII strings of equal length.
 * Returns true when they match.
 */
function safeCompareTokens(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length !== expected.length) return false;
  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Resolve company IDs
  let companyIds;
  const resolveClient = await pool.connect();
  try {
    if (allCompanies) {
      const { rows } = await resolveClient.query("SELECT id FROM companies ORDER BY id");
      companyIds = rows.map((r) => r.id);
      if (companyIds.length === 0) {
        console.error("ERROR: No companies found in the database.");
        process.exit(1);
      }
    } else {
      const parsed = parseInt(companyArg, 10);
      if (isNaN(parsed)) {
        console.error(`ERROR: --company "${companyArg}" is not a valid integer`);
        process.exit(1);
      }
      companyIds = [parsed];
    }
  } finally {
    resolveClient.release();
  }

  const dryRun = !apply;

  console.log(dryRun ? "=== DRY RUN — no changes will be written ===" : "=== APPLY MODE — changes will be written ===");
  console.log(`Companies: ${companyIds.join(", ")}`);

  // ── In apply mode: pre-validate the confirmation token BEFORE any writes ──
  if (apply) {
    console.log("\nValidating confirmation token against current database state...");
    const validateClient = await pool.connect();
    let preScanReports = [];
    try {
      for (const cid of companyIds) {
        const report = await scanCompany(validateClient, cid);
        preScanReports.push(...report);
      }
    } finally {
      validateClient.release();
    }

    const freshHash = buildReportHash(preScanReports);
    const expectedToken = generateToken(companyIds, freshHash);

    if (!safeCompareTokens(confirmToken, expectedToken)) {
      console.error(`\nERROR: Confirmation token mismatch.`);
      console.error(`  Provided : ${confirmToken}`);
      console.error(`  Expected : ${expectedToken}`);
      console.error(`\nPossible causes:`);
      console.error(`  • Database state changed since the dry-run (new vouchers or entries added)`);
      console.error(`  • Different --company scope used for dry-run vs apply`);
      console.error(`  • Token was copy-pasted incorrectly`);
      console.error(`\nRe-run without --apply to get a fresh token for the current state.`);
      process.exit(1);
    }

    console.log("✓ Token verified — database state matches dry-run.");
  }

  // ── Main scan + optional apply ──────────────────────────────────────────────
  const allReports = [];
  const client = await pool.connect();
  try {
    if (dryRun) {
      // Dry run: scan only, no transaction needed
      for (const cid of companyIds) {
        const report = await scanCompany(client, cid);
        allReports.push(...report);

        const counts = {};
        for (const r of report) counts[r.classification] = (counts[r.classification] || 0) + 1;
        const repairable = report.filter((r) => r.repairable).length;
        console.log(`\nCompany ${cid}: ${report.length} entries scanned`);
        for (const [cls, count] of Object.entries(counts)) console.log(`  ${cls}: ${count}`);
        console.log(`  → auto-repairable: ${repairable}`);
        console.log(`  → manual-review: ${(counts["ambiguous"] || 0) + (counts["missing-rate"] || 0) + (counts["invalid-rate"] || 0)}`);
      }

      // Generate confirmation token
      const reportHash = buildReportHash(allReports);
      const token = generateToken(companyIds, reportHash);
      console.log(`\n[DRY RUN] No changes written.`);
      console.log(`\nConfirmation token for --apply: ${token}`);
      console.log(`Re-run with: --apply --confirm ${token}`);
      if (companyIds.length === 1) {
        console.log(`Full command: node scripts/backfill-voucher-entry-currency-amounts.mjs --company ${companyIds[0]} --apply --confirm ${token}`);
      }
    } else {
      // Apply mode: transact per-company with advisory lock
      for (const cid of companyIds) {
        await client.query("BEGIN");
        try {
          const report = await scanCompany(client, cid);
          allReports.push(...report);

          const { attempted, applied } = await applyRepairs(client, cid, report);
          await client.query("COMMIT");
          console.log(`\nCompany ${cid}: applied ${applied} / ${attempted} repairs ✓`);
        } catch (err) {
          await client.query("ROLLBACK");
          console.error(`\nERROR repairing company ${cid} — rolled back:`, err.message);
          process.exit(1);
        }
      }
      console.log("\n[APPLY] All transactions committed successfully.");
    }
  } finally {
    client.release();
    await pool.end();
  }

  // ── Write CSV report ────────────────────────────────────────────────────────
  if (csvOut && allReports.length > 0) {
    const headers = Object.keys(allReports[0]).join(",");
    const rows = allReports.map((r) =>
      Object.values(r)
        .map((v) => (v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`))
        .join(",")
    );
    fs.writeFileSync(csvOut, [headers, ...rows].join("\n"), "utf8");
    console.log(`\nDiagnostic report written to: ${path.resolve(csvOut)}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const counts = {};
  for (const r of allReports) counts[r.classification] = (counts[r.classification] || 0) + 1;

  const repairableTotal = allReports.filter((r) => r.repairable).length;
  const manualTotal = allReports.filter((r) => ["ambiguous", "missing-rate", "invalid-rate"].includes(r.classification)).length;
  const alreadyDone = counts["already-repaired"] || 0;

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total entries scanned     : ${allReports.length}`);
  console.log(`Already repaired          : ${alreadyDone}`);
  console.log(`Confirmed base-stored     : ${counts["confirmed-base-stored"] || 0}`);
  console.log(`Confirmed tx-stored       : ${counts["confirmed-transaction-stored"] || 0}`);
  console.log(`Identity USD              : ${counts["identity-usd"] || 0}`);
  console.log(`Ambiguous                 : ${counts["ambiguous"] || 0}`);
  console.log(`Missing rate              : ${counts["missing-rate"] || 0}`);
  console.log(`Invalid rate              : ${counts["invalid-rate"] || 0}`);
  console.log(`Auto-repairable           : ${repairableTotal}`);
  console.log(`Manual review required    : ${manualTotal}`);

  if (dryRun && repairableTotal > 0) {
    console.log(`\nRun with --apply --confirm <token> to persist ${repairableTotal} repairs.`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
