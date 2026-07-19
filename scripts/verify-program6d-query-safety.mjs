#!/usr/bin/env node

/**
 * Program 6D static safety guard.
 *
 * Protects the database-optimization boundaries that must not be bypassed by
 * future performance work. This script is read-only and does not contact or
 * mutate the database.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const audit = read("scripts/audit-program6d-database-query-risks.mjs");
const validator = read("scripts/validate-program6d-query-classifications.mjs");
const runner = read("scripts/run-program6d-query-review.mjs");
const documentation = read("docs/program-6d-database-query-optimization.md");
const netProfit = read("server/routes/stats/statsNetProfitRoutes.ts");

assert(audit.includes("possible-n-plus-one"), "6D audit must continue detecting looped database awaits.");
assert(audit.includes("possibly-unbounded-read"), "6D audit must continue detecting potentially unbounded reads.");
assert(audit.includes("sequential-query-candidate"), "6D audit must continue detecting sequential query candidates.");
assert(audit.includes("Do not add indexes without query-plan evidence"), "6D audit must retain the query-plan evidence rule.");
assert(validator.includes("unresolvedHighSeverity"), "6D classification validation must retain a high-severity completion gate.");
assert(validator.includes('classification.status === "deferred"'), "Deferred high-severity findings must remain unresolved in strict mode.");
assert(runner.includes("audit-program6d-database-query-risks.mjs"), "6D review runner must execute the canonical scanner.");
assert(runner.includes("validate-program6d-query-classifications.mjs"), "6D review runner must validate classifications when supplied.");
assert(documentation.includes("Do not add an index from static inspection alone"), "6D documentation must prohibit evidence-free indexes.");
assert(documentation.includes("Pagination must not change totals or balances"), "6D documentation must preserve full-dataset financial totals.");
// After the Program 6D grouped-SQL optimisation, the entry queries use raw SQL
// via pool.query.  The safety invariants are now expressed as raw SQL patterns.
assert(netProfit.includes("la.company_id = $1"), "Net-profit migrated-account attribution must remain account-company scoped (la.company_id = $1).");
assert(netProfit.includes("v.company_id    = $1"), "Net-profit supplier and employee attribution must remain voucher-company scoped (v.company_id = $1).");
assert(netProfit.includes("ve.credit_amount::numeric = 0"), "Supplier pure-credit SQL filter (mixed FX exclusion) must remain in grouped SQL.");
assert(netProfit.includes("ve.debit_amount::numeric  = 0"), "Supplier pure-debit SQL filter (mixed FX exclusion) must remain in grouped SQL.");

if (failures.length > 0) {
  console.error("Program 6D query-safety verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Program 6D query-safety invariants verified.");
