#!/usr/bin/env node
/**
 * Historical voucher-currency CLI compatibility notice.
 *
 * The former implementation classified legacy rows from amount-size thresholds
 * and could not prove whether debit_amount / credit_amount stored transaction
 * currency or historical base currency. That write path is intentionally
 * retired. Historical repairs now run through the authenticated ERP repair
 * center, which uses persisted evidence, signed previews, stale-row detection,
 * complete-voucher approval, transactional apply, audit logging, and post-write
 * reconciliation.
 */

const applyRequested = process.argv.slice(2).includes("--apply");

console.log("Historical currency backfill CLI retired.");
console.log("Open ERP → Accounts → Historical Currency Stabilization.");
console.log("Use the evidence-backed automatic preview for supported rows and manual voucher review for ambiguous rows.");
console.log("No database connection was opened and no write was performed.");

if (applyRequested) {
  console.error("Refusing --apply: heuristic command-line historical repairs are no longer supported.");
  process.exitCode = 2;
}
