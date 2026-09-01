#!/usr/bin/env node
/**
 * Program 6D — Real-database reconciliation for the net-profit voucher-entry aggregation.
 *
 * SAFETY RULES (enforced):
 *  - Runs entirely inside an explicitly READ ONLY transaction.
 *  - Sets a local statement_timeout of 30 seconds on every query.
 *  - Rolls back at the end (no writes possible in READ ONLY, but explicit ROLLBACK is kept
 *    for clarity and to release any shared locks immediately).
 *  - Never modifies data, calls HTTP endpoints, or alters schema.
 *  - Output contains only: anonymized case IDs, company IDs, dates, entity IDs, numeric
 *    totals, and PASS/FAIL flags — no names, narrations, or full record bodies.
 *
 * Usage:
 *   node scripts/reconcile-program6d-net-profit.mjs
 *   node scripts/reconcile-program6d-net-profit.mjs --json=tmp/program6d-net-profit-reconciliation.json
 *
 * Exit codes:
 *   0  all cases passed
 *   1  one or more cases failed
 *   2  fatal error (DB connection, missing env, etc.)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

// ── CLI args ─────────────────────────────────────────────────────────────────
const argsMap = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...vParts] = a.split("=");
    return [k, vParts.join("=")];
  }),
);
const jsonOutputPath = argsMap.get("--json") || null;

// ── Database connection ───────────────────────────────────────────────────────
function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (PGHOST && PGPORT && PGUSER && PGPASSWORD && PGDATABASE) {
    return `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  }
  throw new Error("No database configuration found. Set DATABASE_URL or PG* environment variables.");
}

const connectionString = buildConnectionString();
const isLocalReplitDB =
  process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
  max: 3,
  connectionTimeoutMillis: 15_000,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Compare two floating-point totals at raw (non-rounded) precision. */
function diff(a, b) {
  return Math.abs(a - b);
}

// Float64 accumulation tolerance.
//
// PostgreSQL SUM(numeric) and JavaScript iterative `+=` accumulate in different
// orders, producing IEEE 754 rounding noise of up to ~2e-9 on sums that involve
// many rows.  We use 1e-7 (one ten-millionth of a unit, 100× smaller than the
// worst observed diff, and 100 000× smaller than 1 cent) as the comparison
// tolerance.  This is a floating-point arithmetic artifact, NOT a semantic
// mismatch: both calculations represent the same underlying stored numeric
// value.  Any difference ≥ 1e-7 indicates a true semantic difference that must
// be investigated.
const EPSILON = 1e-7;

function isPassing(debitDiff, creditDiff) {
  return debitDiff < EPSILON && creditDiff < EPSILON;
}

// ── Core query helpers (read-only, no side effects) ──────────────────────────

/**
 * Current implementation — mirrors statsNetProfitRoutes.ts exactly.
 *
 * Two separate queries:
 *  1. ledgerAccEntries  — JOIN on ledger_accounts.company_id = companyId
 *  2. companyEntries    — JOIN on vouchers.company_id = companyId
 *
 * Returns maps: accountBalances, supplierBalances, employeeBalances
 * (all at raw numeric precision, no rounding).
 */
async function runCurrentCalc(client, companyId, toDate) {
  const dateClause = toDate ? `AND v.voucher_date <= $2` : "";
  const params1 = toDate ? [companyId, toDate] : [companyId];

  // ledgerAccEntries: account-scoped (migrated-account attribution)
  const laResult = await client.query(
    `SELECT ve.ledger_account_id,
            ve.debit_amount::numeric  AS debit,
            ve.credit_amount::numeric AS credit
     FROM voucher_entries ve
     JOIN vouchers        v  ON ve.voucher_id       = v.id
     JOIN ledger_accounts la ON ve.ledger_account_id = la.id
     WHERE la.company_id  = $1
       AND v.optional      = false
       AND v.deleted_at   IS NULL
       ${dateClause}`,
    params1,
  );

  // companyEntries: voucher-scoped (supplier + employee attribution)
  const ceResult = await client.query(
    `SELECT ve.ledger_account_id,
            ve.supplier_id,
            ve.employee_id,
            ve.debit_amount::numeric  AS debit,
            ve.credit_amount::numeric AS credit
     FROM voucher_entries ve
     JOIN vouchers v ON ve.voucher_id = v.id
     WHERE v.company_id  = $1
       AND v.optional     = false
       AND v.deleted_at  IS NULL
       ${dateClause}`,
    params1,
  );

  // Build accountBalances
  const accountBalances = new Map();
  for (const row of laResult.rows) {
    const id = row.ledger_account_id;
    if (!id) continue;
    const debit  = parseFloat(row.debit  ?? "0");
    const credit = parseFloat(row.credit ?? "0");
    const cur = accountBalances.get(id) ?? { debit: 0, credit: 0 };
    accountBalances.set(id, { debit: cur.debit + debit, credit: cur.credit + credit });
  }

  // Build supplierBalances (pure-side only: excludes mixed FX settlement rows)
  const supplierBalances = new Map();
  for (const row of ceResult.rows) {
    const id = row.supplier_id;
    if (!id) continue;
    const debit  = parseFloat(row.debit  ?? "0");
    const credit = parseFloat(row.credit ?? "0");
    const cur = supplierBalances.get(id) ?? { debit: 0, credit: 0 };
    if (credit > 0 && debit === 0) {
      supplierBalances.set(id, { debit: cur.debit, credit: cur.credit + credit });
    } else if (debit > 0 && credit === 0) {
      supplierBalances.set(id, { debit: cur.debit + debit, credit: cur.credit });
    }
    // Mixed rows (debit > 0 AND credit > 0) are intentionally excluded
  }

  // Build employeeBalances
  const employeeBalances = new Map();
  for (const row of ceResult.rows) {
    const id = row.employee_id;
    if (!id) continue;
    const debit  = parseFloat(row.debit  ?? "0");
    const credit = parseFloat(row.credit ?? "0");
    const cur = employeeBalances.get(id) ?? { debit: 0, credit: 0 };
    employeeBalances.set(id, { debit: cur.debit + debit, credit: cur.credit + credit });
  }

  return { accountBalances, supplierBalances, employeeBalances };
}

/**
 * Grouped-SQL candidate — preserves all 10 rules from the reconciliation spec.
 *
 * Three separate grouped queries, each matching the exact WHERE conditions and
 * company-scoping rules of the current implementation.
 *
 * Rule 4+5: supplier pure-side filtering is pushed into SQL CASE expressions so
 * mixed FX rows contribute 0 to both sides rather than being counted.
 */
async function runCandidateCalc(client, companyId, toDate) {
  const dateClause = toDate ? `AND v.voucher_date <= $2` : "";
  const params = toDate ? [companyId, toDate] : [companyId];

  // Candidate 1 — ledger-account balances (account-company scoped, rule 1+2)
  const laResult = await client.query(
    `SELECT ve.ledger_account_id,
            SUM(ve.debit_amount::numeric)  AS total_debit,
            SUM(ve.credit_amount::numeric) AS total_credit
     FROM voucher_entries ve
     JOIN vouchers        v  ON ve.voucher_id        = v.id
     JOIN ledger_accounts la ON ve.ledger_account_id = la.id
     WHERE la.company_id  = $1
       AND v.optional      = false
       AND v.deleted_at   IS NULL
       ${dateClause}
     GROUP BY ve.ledger_account_id`,
    params,
  );

  // Candidate 2 — supplier balances (voucher-company scoped, pure-side rule 3+4+5)
  const supResult = await client.query(
    `SELECT ve.supplier_id,
            SUM(CASE WHEN ve.debit_amount::numeric  > 0
                          AND ve.credit_amount::numeric = 0
                     THEN ve.debit_amount::numeric ELSE 0 END) AS total_debit,
            SUM(CASE WHEN ve.credit_amount::numeric > 0
                          AND ve.debit_amount::numeric  = 0
                     THEN ve.credit_amount::numeric ELSE 0 END) AS total_credit
     FROM voucher_entries ve
     JOIN vouchers v ON ve.voucher_id = v.id
     WHERE v.company_id  = $1
       AND ve.supplier_id IS NOT NULL
       AND v.optional     = false
       AND v.deleted_at  IS NULL
       ${dateClause}
     GROUP BY ve.supplier_id`,
    params,
  );

  // Candidate 3 — employee balances (voucher-company scoped, rule 3)
  const empResult = await client.query(
    `SELECT ve.employee_id,
            SUM(ve.debit_amount::numeric)  AS total_debit,
            SUM(ve.credit_amount::numeric) AS total_credit
     FROM voucher_entries ve
     JOIN vouchers v ON ve.voucher_id = v.id
     WHERE v.company_id  = $1
       AND ve.employee_id IS NOT NULL
       AND v.optional     = false
       AND v.deleted_at  IS NULL
       ${dateClause}
     GROUP BY ve.employee_id`,
    params,
  );

  const accountBalances = new Map();
  for (const row of laResult.rows) {
    const id = row.ledger_account_id;
    if (!id) continue;
    accountBalances.set(id, {
      debit:  parseFloat(row.total_debit  ?? "0"),
      credit: parseFloat(row.total_credit ?? "0"),
    });
  }

  const supplierBalances = new Map();
  for (const row of supResult.rows) {
    const id = row.supplier_id;
    if (!id) continue;
    supplierBalances.set(id, {
      debit:  parseFloat(row.total_debit  ?? "0"),
      credit: parseFloat(row.total_credit ?? "0"),
    });
  }

  const employeeBalances = new Map();
  for (const row of empResult.rows) {
    const id = row.employee_id;
    if (!id) continue;
    employeeBalances.set(id, {
      debit:  parseFloat(row.total_debit  ?? "0"),
      credit: parseFloat(row.total_credit ?? "0"),
    });
  }

  return { accountBalances, supplierBalances, employeeBalances };
}

// ── Test-case selection ───────────────────────────────────────────────────────

/** Automatically discover real-data test cases from the database (read-only). */
async function selectTestCases(client) {
  // Distinct companies that have at least one non-deleted voucher
  const companyRows = await client.query(
    `SELECT DISTINCT company_id FROM vouchers
     WHERE deleted_at IS NULL AND optional = false
     ORDER BY company_id
     LIMIT 8`,
  );
  const companyIds = companyRows.rows.map((r) => r.company_id);

  // Parent/child company discovery
  const parentRows = await client.query(
    `SELECT id, parent_company_id FROM companies
     WHERE id = ANY($1::int[]) AND parent_company_id IS NOT NULL
     LIMIT 4`,
    [companyIds],
  );
  const parentChildIds = parentRows.rows.flatMap((r) => [r.id, r.parent_company_id]);

  // Migrated ledger accounts (accounts whose vouchers span multiple companies)
  const migratedRows = await client.query(
    `SELECT DISTINCT la.company_id
     FROM ledger_accounts la
     JOIN voucher_entries ve ON ve.ledger_account_id = la.id
     JOIN vouchers         v  ON ve.voucher_id        = v.id
     WHERE la.company_id != v.company_id
       AND v.deleted_at IS NULL
       AND v.optional    = false
     LIMIT 3`,
  );
  const migratedCompanyIds = migratedRows.rows.map((r) => r.company_id);

  // Mixed FX settlement rows (debit > 0 AND credit > 0)
  const fxRows = await client.query(
    `SELECT DISTINCT v.company_id
     FROM voucher_entries ve
     JOIN vouchers v ON ve.voucher_id = v.id
     WHERE ve.supplier_id IS NOT NULL
       AND ve.debit_amount::numeric  > 0
       AND ve.credit_amount::numeric > 0
       AND v.deleted_at IS NULL
       AND v.optional    = false
     LIMIT 3`,
  );
  const fxCompanyIds = fxRows.rows.map((r) => r.company_id);

  // Historical dates: oldest voucher date, mid-range date, near-current date per company
  const dateRows = await client.query(
    `SELECT company_id,
            MIN(voucher_date) AS oldest,
            MAX(voucher_date) AS newest
     FROM vouchers
     WHERE deleted_at IS NULL AND optional = false
     GROUP BY company_id
     LIMIT 8`,
  );
  const dateMap = new Map();
  for (const r of dateRows.rows) {
    const oldest = r.oldest instanceof Date ? r.oldest.toISOString().slice(0,10) : String(r.oldest).slice(0,10);
    const newest = r.newest instanceof Date ? r.newest.toISOString().slice(0,10) : String(r.newest).slice(0,10);
    // Derive two intermediate historical dates by simple string arithmetic
    const oldestMs = new Date(oldest).getTime();
    const newestMs = new Date(newest).getTime();
    const p33 = new Date(oldestMs + (newestMs - oldestMs) * 0.33).toISOString().slice(0, 10);
    const p66 = new Date(oldestMs + (newestMs - oldestMs) * 0.66).toISOString().slice(0, 10);
    dateMap.set(r.company_id, [oldest, p33, p66, newest]);
  }

  // All unique company IDs to cover
  const allCompanyIds = [
    ...new Set([...companyIds, ...parentChildIds, ...migratedCompanyIds, ...fxCompanyIds]),
  ].filter(Boolean);

  const cases = [];
  let caseIdx = 0;

  for (const companyId of allCompanyIds) {
    const dates = dateMap.get(companyId) ?? [null];
    // Always include current date (no date filter) + at least 3 historical dates
    const asOfDates = [null, ...dates].slice(0, 4);

    for (const toDate of asOfDates) {
      const dateStr = toDate
        ? (toDate instanceof Date ? toDate.toISOString().slice(0, 10) : String(toDate).slice(0, 10))
        : null;
      cases.push({
        caseId:    `C${String(++caseIdx).padStart(3, "0")}`,
        companyId,
        toDate:    dateStr,
        isMigratedCompany:  migratedCompanyIds.includes(companyId),
        isMixedFxCompany:   fxCompanyIds.includes(companyId),
        isParentChild:      parentChildIds.includes(companyId),
      });
    }
  }

  // Empty-result cases: companies with no vouchers (to verify empty-map behavior)
  const emptyRows = await client.query(
    `SELECT id FROM companies
     WHERE id NOT IN (SELECT DISTINCT company_id FROM vouchers WHERE deleted_at IS NULL)
     LIMIT 2`,
  );
  for (const r of emptyRows.rows) {
    cases.push({
      caseId:    `C${String(++caseIdx).padStart(3, "0")}`,
      companyId: r.id,
      toDate:    null,
      isEmpty:   true,
      isMigratedCompany: false,
      isMixedFxCompany:  false,
      isParentChild:     false,
    });
  }

  return cases;
}

// ── Main reconciliation ───────────────────────────────────────────────────────
async function main() {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error(`Fatal: could not connect to database: ${err.message}`);
    process.exit(2);
  }

  try {
    // Start an explicitly READ ONLY transaction
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");

    console.log("Program 6D — net-profit reconciliation");
    console.log("Transaction: READ ONLY | statement_timeout: 30s");
    console.log("");

    // Select test cases
    const testCases = await selectTestCases(client);
    console.log(`Test cases selected: ${testCases.length}`);
    console.log("");

    const results = [];
    let maxAbsDiff = 0;
    let migratedCovered = 0;
    let mixedFxCovered  = 0;
    const companiesCovered = new Set();
    const historicalDatesCovered = new Set();

    for (const tc of testCases) {
      const { caseId, companyId, toDate } = tc;
      companiesCovered.add(companyId);
      if (toDate) historicalDatesCovered.add(toDate);

      let caseResults = [];
      let caseError   = null;

      try {
        await client.query("SET LOCAL statement_timeout = '30s'");
        const [current, candidate] = await Promise.all([
          runCurrentCalc(client, companyId, toDate),
          runCandidateCalc(client, companyId, toDate),
        ]);

        // Compare entity types: ledger-account, supplier, employee
        const entityTypes = [
          { type: "ledger_account", currentMap: current.accountBalances,  candidateMap: candidate.accountBalances  },
          { type: "supplier",       currentMap: current.supplierBalances,  candidateMap: candidate.supplierBalances  },
          { type: "employee",       currentMap: current.employeeBalances,  candidateMap: candidate.employeeBalances  },
        ];

        for (const { type, currentMap, candidateMap } of entityTypes) {
          // Collect all IDs present in either map
          const allIds = new Set([...currentMap.keys(), ...candidateMap.keys()]);

          if (allIds.size === 0) {
            // Empty-result case for this entity type
            caseResults.push({
              caseId,
              companyId,
              toDate:         toDate ?? "current",
              entityType:     type,
              entityId:       null,
              currentDebit:   0,
              currentCredit:  0,
              candidateDebit: 0,
              candidateCredit:0,
              debitDiff:      0,
              creditDiff:     0,
              result:         "PASS",
            });
            continue;
          }

          for (const entityId of allIds) {
            const cur = currentMap.get(entityId)   ?? { debit: 0, credit: 0 };
            const cnd = candidateMap.get(entityId) ?? { debit: 0, credit: 0 };

            const debitDiff  = diff(cur.debit,  cnd.debit);
            const creditDiff = diff(cur.credit, cnd.credit);
            const pass = isPassing(debitDiff, creditDiff);

            maxAbsDiff = Math.max(maxAbsDiff, debitDiff, creditDiff);
            if (tc.isMigratedCompany) migratedCovered++;
            if (tc.isMixedFxCompany)  mixedFxCovered++;

            caseResults.push({
              caseId,
              companyId,
              toDate:         toDate ?? "current",
              entityType:     type,
              entityId,
              currentDebit:   cur.debit,
              currentCredit:  cur.credit,
              candidateDebit: cnd.debit,
              candidateCredit:cnd.credit,
              debitDiff,
              creditDiff,
              result:         pass ? "PASS" : "FAIL",
            });
          }
        }
      } catch (err) {
        caseError = err.message;
        caseResults.push({
          caseId,
          companyId,
          toDate:     toDate ?? "current",
          entityType: "error",
          entityId:   null,
          error:      caseError,
          result:     "FAIL",
        });
      }

      results.push(...caseResults);
    }

    // Summarize
    const totalCases   = results.length;
    const passedCases  = results.filter((r) => r.result === "PASS").length;
    const failedCases  = results.filter((r) => r.result === "FAIL").length;

    const summary = {
      program:             "6D",
      reconciliationType:  "net-profit-voucher-entry-aggregation",
      runAt:               new Date().toISOString(),
      transactionMode:     "READ ONLY",
      statementTimeout:    "30s",
      casesTested:         totalCases,
      casesPassed:         passedCases,
      casesFailed:         failedCases,
      maxAbsoluteDiff:     maxAbsDiff,
      migratedAccountCasesCovered: migratedCovered,
      mixedFxCasesCovered: mixedFxCovered,
      companiesCovered:    [...companiesCovered].length,
      historicalDatesCovered: [...historicalDatesCovered].length,
      passed:              failedCases === 0,
      results,
    };

    // Print human-readable summary
    console.log(`Cases tested:     ${totalCases}`);
    console.log(`Cases passed:     ${passedCases}`);
    console.log(`Cases failed:     ${failedCases}`);
    console.log(`Max abs diff:     ${maxAbsDiff}`);
    console.log(`Companies covered: ${[...companiesCovered].length}`);
    console.log(`Historical dates:  ${[...historicalDatesCovered].length}`);
    console.log(`Migrated-acct cases: ${migratedCovered}`);
    console.log(`Mixed-FX cases:      ${mixedFxCovered}`);
    console.log(`Result: ${failedCases === 0 ? "PASS — all cases match" : "FAIL — mismatches found"}`);

    if (failedCases > 0) {
      console.log("\nFailing cases:");
      for (const r of results.filter((x) => x.result === "FAIL").slice(0, 20)) {
        console.log(
          `  ${r.caseId} company=${r.companyId} date=${r.toDate} type=${r.entityType}` +
          (r.entityId ? ` id=${r.entityId}` : "") +
          (r.error ? ` ERROR: ${r.error}` : ` debitDiff=${r.debitDiff} creditDiff=${r.creditDiff}`),
        );
      }
    }

    // Write JSON output
    if (jsonOutputPath) {
      const outPath = resolve(process.cwd(), jsonOutputPath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      console.log(`\nFull results written to: ${outPath}`);
    }

    await client.query("ROLLBACK");

    process.exit(failedCases > 0 ? 1 : 0);
  } catch (err) {
    console.error(`Fatal error during reconciliation: ${err.message}`);
    try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
    process.exit(2);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Unhandled error: ${err.message}`);
  process.exit(2);
});
