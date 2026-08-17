#!/usr/bin/env node
/**
 * audit-write-evidence.mjs
 *
 * Two properties that the existing gates cannot see.
 *
 * `audit-write-route-coverage.mjs` asks whether a sensitive write route is
 * *tested*. It is at zero and stays there. But a route can be fully tested and
 * still write money or stock without leaving the evidence the rest of the
 * system reconciles against:
 *
 *   Journal evidence — a file that changes `inventory` without going through
 *   postStockMovementTx moves stock with no row in the canonical movement
 *   journal. Convergence reconciliation compares documents against that
 *   journal, so an unjournalled mutation is not a discrepancy it reports; it is
 *   a discrepancy it cannot see.
 *
 *   Request identity — a file that creates a voucher without resolving a client
 *   request id has no idempotency key, so a retried submission posts the
 *   entries twice. The retry does not have to be a user double-click: a proxy
 *   timeout, a mobile network handover, or an offline queue replay is enough.
 *
 * Both are backlogs, not zeros — the repository has a lot of both — so this
 * works the way the lint and type-escape gates work: measure, pin, and forbid
 * growth. It also pins the *set*, not only the count, because a backlog that
 * stays at 71 while a different file joins it is a new defect wearing an old
 * number.
 *
 * Nothing here is a substitute for the journal or the idempotency key. It is
 * the thing that notices when the next write path forgets them.
 *
 * Usage:
 *   npm run audit:write-evidence
 *   node scripts/audit-write-evidence.mjs --json
 *   UPDATE_WRITE_EVIDENCE_BASELINE=1 node scripts/audit-write-evidence.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(projectRoot, "config/write-evidence-baseline.json");

/**
 * Schema-creation and migration code legitimately touches these tables without
 * being a business write path: it is building the tables, not moving stock.
 */
const EXCLUDED_PREFIXES = ["server/startup-schema/", "server/db.ts", "server/migrations/"];

/** A write to the named table, in either drizzle or raw SQL form. */
function writesTable(source, table, camel) {
  const drizzle = new RegExp(String.raw`\.(?:insert|update|delete)\(\s*(?:schema\.)?(?:${table}|${camel})\s*[,)]`);
  const raw = new RegExp(String.raw`\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?${table}"?\b`, "i");
  return drizzle.test(source) || raw.test(source);
}

/**
 * A new row in the named table. Request identity is about replay-safe creation:
 * updating, soft-deleting, restoring, or moving an existing voucher cannot
 * create a second voucher row, so those operations must not inflate the
 * duplicate-posting backlog.
 */
function createsTableRow(source, table, camel) {
  const drizzle = new RegExp(String.raw`\.insert\(\s*(?:schema\.)?(?:${table}|${camel})\s*[,)]`);
  const raw = new RegExp(String.raw`\bINSERT\s+INTO\s+"?${table}"?\b`, "i");
  return drizzle.test(source) || raw.test(source);
}

/**
 * Stock also moves without any statement naming the table.
 *
 * server/inventoryHelper.ts owns the balance arithmetic, and most write paths
 * call adjustInventory() rather than writing `inventory` themselves — then the
 * ones that were converted call postStockMovementTx() beside it to record what
 * moved. Matching only the table missed every caller of the helper: thirty
 * files that move stock and journal nothing were invisible to this audit while
 * it reported a tidy backlog of twenty-one.
 *
 * The helper itself is not a gap and is exempt below: it is the layer the
 * journal sits above, and it has no idea which document is calling it.
 */
const STOCK_BALANCE_HELPER = /\b(?:adjustInventory|reverseInventoryByExactValue)\s*\(/;
const STOCK_BALANCE_HELPER_MODULE = "server/inventoryHelper.ts";

function mutatesStock(file, source) {
  if (file === STOCK_BALANCE_HELPER_MODULE) return false;
  return writesTable(source, "inventory", "inventory") || STOCK_BALANCE_HELPER.test(source);
}

/** Reaching the canonical movement journal, by whichever door. */
const JOURNAL_WRITER = /\b(?:postStockMovementTx|journalStockTransferLeg)\b/;

/**
 * Any of the request-identity mechanisms. Phase 4 additionally has a durable
 * HTTP request boundary registered before application routes. The explicit set
 * below is intentionally file-pinned: broad middleware must never turn into an
 * excuse for newly-created voucher writers to receive credit automatically.
 */
const REQUEST_IDENTITY =
  /\b(?:clientRequestId|resolveStockDocumentRequestId|stockDocumentIdempotencyKey|postBalancedVoucherTx|insertInfrastructureVoucherTx|insertInfrastructureVoucher)\b/;

const IDENTITY_OWNING_VOUCHER_WRITERS = new Set([
  "server/services/accounting/voucherPostingService.ts",
  "server/services/accounting/infrastructureVoucherIdentity.ts",
]);

export const PHASE4_OPERATIONAL_REQUEST_BOUNDARY_WRITERS = new Set([
  "server/routes/employees/salaryAdvanceRoutes.ts",
  "server/routes/erp-payroll/bonuses.ts",
  "server/routes/erp-payroll/bulk-adjustments.ts",
  "server/routes/erp-payroll/employee-deposits.ts",
  "server/routes/erp-payroll/runs.ts",
  "server/routes/erp-payroll/withdrawals.ts",
  "server/routes/erp-payroll/worker-payments.ts",
  "server/routes/factory/employee-pos/employee-crud/bulk-payroll.ts",
  "server/routes/factory/employee-pos/employee-crud/bulk-withdraw.ts",
  "server/routes/factory/employee-pos/employee-crud/cash.ts",
  "server/routes/factory/employee-pos/employeeAdvancesBonusRoutes.ts",
  "server/routes/factory/employee-pos/pos-financial/sale-write.ts",
  "server/routes/factory/suppliers/crud/payments.ts",
  "server/routes/payroll/advance-accounting/bulk-repay.ts",
  "server/routes/payroll/advance-accounting/cash.ts",
  "server/routes/payroll/advance-accounting/repay-by-month.ts",
  "server/routes/payroll/advance-accounting/repayment-audit.ts",
  "server/routes/payroll/advance-accounting/repayments.ts",
  "server/routes/payroll/core/mark-paid.ts",
  "server/routes/vouchers/voucherCreateRoutes.ts",
  "server/routes/vouchers/voucherJournalRoutes.ts",
  "server/routes/vouchers/voucherPaymentRoutes.ts",
]);

function sourceFiles(directory, collected = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(absolute, collected);
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts") || entry.name.endsWith(".test.ts")) continue;
    collected.push(path.relative(projectRoot, absolute).split(path.sep).join("/"));
  }
  return collected;
}

export function auditWriteEvidence() {
  const files = sourceFiles(path.join(projectRoot, "server"))
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .sort();

  const unjournalledStockWrites = [];
  const voucherWritesWithoutRequestIdentity = [];
  let journalledStockWrites = 0;
  let voucherWritesWithRequestIdentity = 0;

  for (const file of files) {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");

    if (mutatesStock(file, source)) {
      if (JOURNAL_WRITER.test(source)) journalledStockWrites += 1;
      else unjournalledStockWrites.push(file);
    }
    if (createsTableRow(source, "vouchers", "vouchers")) {
      if (
        IDENTITY_OWNING_VOUCHER_WRITERS.has(file) ||
        PHASE4_OPERATIONAL_REQUEST_BOUNDARY_WRITERS.has(file) ||
        REQUEST_IDENTITY.test(source)
      ) {
        voucherWritesWithRequestIdentity += 1;
      } else {
        voucherWritesWithoutRequestIdentity.push(file);
      }
    }
  }

  return {
    scannedFiles: files.length,
    unjournalledStockWrites,
    voucherWritesWithoutRequestIdentity,
    journalledStockWrites,
    voucherWritesWithRequestIdentity,
  };
}

function readBaseline() {
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

export function compareBacklog(label, measured, pinned) {
  const errors = [];
  const notes = [];
  const pinnedSet = new Set(pinned.files);
  const measuredSet = new Set(measured);

  const added = measured.filter((file) => !pinnedSet.has(file));
  const removed = pinned.files.filter((file) => !measuredSet.has(file));

  if (measured.length > pinned.ceiling) {
    errors.push(`${label}: ${measured.length} exceeds the ceiling of ${pinned.ceiling}.`);
  }
  for (const file of added) {
    errors.push(`${label}: ${file} joined the backlog. New write paths must carry the evidence.`);
  }
  if (removed.length > 0) {
    notes.push(
      `${label}: ${removed.length} file(s) left the backlog. Re-pin with UPDATE_WRITE_EVIDENCE_BASELINE=1 to lock the improvement in: ${removed.join(", ")}`
    );
  }
  return { errors, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditWriteEvidence();

  if (process.env.UPDATE_WRITE_EVIDENCE_BASELINE === "1") {
    const existing = readBaseline();
    const updated = {
      ...existing,
      stockWritesWithoutJournalEvidence: {
        ...existing.stockWritesWithoutJournalEvidence,
        ceiling: result.unjournalledStockWrites.length,
        files: result.unjournalledStockWrites,
      },
      voucherWritesWithoutRequestIdentity: {
        ...existing.voucherWritesWithoutRequestIdentity,
        ceiling: result.voucherWritesWithoutRequestIdentity.length,
        files: result.voucherWritesWithoutRequestIdentity,
      },
    };
    fs.writeFileSync(baselinePath, `${JSON.stringify(updated, null, 2)}\n`);
    console.log(
      `Re-pinned: ${result.unjournalledStockWrites.length} unjournalled stock writes, ` +
        `${result.voucherWritesWithoutRequestIdentity.length} voucher writes without request identity.`
    );
    process.exit(0);
  }

  const baseline = readBaseline();
  const stock = compareBacklog(
    "Stock writes without journal evidence",
    result.unjournalledStockWrites,
    baseline.stockWritesWithoutJournalEvidence
  );
  const vouchers = compareBacklog(
    "Voucher writes without request identity",
    result.voucherWritesWithoutRequestIdentity,
    baseline.voucherWritesWithoutRequestIdentity
  );
  const errors = [...stock.errors, ...vouchers.errors];
  const notes = [...stock.notes, ...vouchers.notes];

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ ...result, errors, notes }, null, 2)}\n`);
  } else {
    console.log(
      `Write evidence across ${result.scannedFiles} server files: ` +
        `${result.unjournalledStockWrites.length} stock writes without journal evidence ` +
        `(ceiling ${baseline.stockWritesWithoutJournalEvidence.ceiling}), ` +
        `${result.voucherWritesWithoutRequestIdentity.length} voucher writes without request identity ` +
        `(ceiling ${baseline.voucherWritesWithoutRequestIdentity.ceiling}).`
    );
    for (const note of notes) console.log(`NOTE: ${note}`);
    for (const error of errors) console.error(`ERROR: ${error}`);
  }

  process.exitCode = errors.length === 0 ? 0 : 1;
}
