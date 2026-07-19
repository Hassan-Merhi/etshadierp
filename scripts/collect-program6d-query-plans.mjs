#!/usr/bin/env node
/**
 * Program 6D — Real query-plan evidence collector.
 *
 * SAFETY RULES (enforced):
 *  - Every EXPLAIN runs inside BEGIN READ ONLY … ROLLBACK.
 *  - Local statement_timeout = 30s on every query.
 *  - Never modifies data or schema.
 *  - Output contains only plan metadata, timing, row counts, buffer stats,
 *    and index names — no data values, no names, no narrations.
 *
 * Usage:
 *   node scripts/collect-program6d-query-plans.mjs
 *   node scripts/collect-program6d-query-plans.mjs --json=tmp/program6d-query-plans.json
 *
 * EXIT CODES:
 *   0  plans collected
 *   2  fatal error
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

// ── CLI ───────────────────────────────────────────────────────────────────────
const argsMap = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.split("=");
    return [k, v.join("=")];
  }),
);
const jsonOutputPath = argsMap.get("--json") || null;

// ── DB connection ─────────────────────────────────────────────────────────────
function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (PGHOST && PGPORT && PGUSER && PGPASSWORD && PGDATABASE) {
    return `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  }
  throw new Error("No database configuration found.");
}

const connectionString = buildConnectionString();
const isLocalReplitDB =
  process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const requiresSSL =
  !isLocalReplitDB && process.env.PGSSLMODE !== "disable";

const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
  max: 3,
  connectionTimeoutMillis: 15_000,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract sanitized metrics from a PG EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) plan. */
function extractPlanMetrics(planJson, queryName, sql, companyId, toDate) {
  const plan = planJson[0]?.Plan ?? planJson[0]?.["Plan"] ?? {};
  const root = planJson[0] ?? {};

  function collectNodes(node, nodes = []) {
    nodes.push(node);
    for (const child of node["Plans"] ?? []) collectNodes(child, nodes);
    return nodes;
  }

  const allNodes = collectNodes(plan);

  const seqScans    = allNodes.filter((n) => n["Node Type"] === "Seq Scan");
  const indexScans  = allNodes.filter((n) => n["Node Type"] === "Index Scan" || n["Node Type"] === "Index Only Scan");
  const bitmapScans = allNodes.filter((n) => n["Node Type"] === "Bitmap Index Scan" || n["Node Type"] === "Bitmap Heap Scan");
  const joins       = allNodes.filter((n) => n["Node Type"]?.includes("Join"));
  const sorts       = allNodes.filter((n) => n["Node Type"] === "Sort");

  return {
    queryName,
    companyId,
    toDate: toDate ?? "current",
    planningTimeMs:         root["Planning Time"]  ?? null,
    executionTimeMs:        root["Execution Time"] ?? null,
    actualRows:             plan["Actual Rows"]    ?? null,
    estimatedRows:          plan["Plan Rows"]      ?? null,
    rowsRemovedByFilter:    allNodes.reduce((s, n) => s + (n["Rows Removed by Filter"] ?? 0), 0),
    sharedBufferHits:       plan["Shared Hit Blocks"]   ?? null,
    sharedBufferReads:      plan["Shared Read Blocks"]  ?? null,
    tempReads:              plan["Temp Read Blocks"]    ?? null,
    tempWrites:             plan["Temp Written Blocks"] ?? null,
    seqScans:               seqScans.map((n) => ({ relation: n["Relation Name"] ?? null, rows: n["Actual Rows"] ?? null })),
    indexScans:             indexScans.map((n) => ({ index: n["Index Name"] ?? null, relation: n["Relation Name"] ?? null, rows: n["Actual Rows"] ?? null })),
    bitmapScans:            bitmapScans.map((n) => ({ index: n["Index Name"] ?? null, relation: n["Relation Name"] ?? null, rows: n["Actual Rows"] ?? null })),
    joinStrategies:         joins.map((n) => n["Node Type"]),
    sortMethods:            sorts.map((n) => n["Sort Method"] ?? null),
    sortMemory:             sorts.map((n) => n["Sort Space Used"] ?? null),
    indexesUsed:            [...new Set(indexScans.concat(bitmapScans).map((n) => n["Index Name"]).filter(Boolean))],
  };
}

/** Run EXPLAIN ANALYZE inside a READ ONLY transaction and return sanitized metrics. */
async function collectPlan(client, queryName, sql, params, companyId, toDate) {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '30s'");
  try {
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
    const result = await client.query(explainSql, params);
    const planJson = result.rows[0]["QUERY PLAN"];
    const metrics = extractPlanMetrics(planJson, queryName, sql, companyId, toDate);
    await client.query("ROLLBACK");
    return { success: true, metrics };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
    return { success: false, error: err.message, queryName, companyId, toDate: toDate ?? "current" };
  }
}

// ── Query definitions ─────────────────────────────────────────────────────────

function getQueries(companyId, toDate) {
  const dateClause = toDate ? `AND v.voucher_date <= $2` : "";
  const params     = toDate ? [companyId, toDate] : [companyId];

  return [
    // ── Current implementation queries ──────────────────────────────────────
    {
      name:   "current-ledger-entries",
      sql:    `SELECT ve.ledger_account_id,
                      ve.debit_amount::numeric  AS debit,
                      ve.credit_amount::numeric AS credit
               FROM voucher_entries ve
               JOIN vouchers        v  ON ve.voucher_id        = v.id
               JOIN ledger_accounts la ON ve.ledger_account_id = la.id
               WHERE la.company_id  = $1
                 AND v.optional      = false
                 AND v.deleted_at   IS NULL
                 ${dateClause}`,
      params,
    },
    {
      name:   "current-company-entries",
      sql:    `SELECT ve.ledger_account_id,
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
      params,
    },
    // ── Grouped-SQL candidate queries ────────────────────────────────────────
    {
      name:   "candidate-ledger-grouped",
      sql:    `SELECT ve.ledger_account_id,
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
    },
    {
      name:   "candidate-supplier-grouped",
      sql:    `SELECT ve.supplier_id,
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
    },
    {
      name:   "candidate-employee-grouped",
      sql:    `SELECT ve.employee_id,
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
    },
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error(`Fatal: could not connect to database: ${err.message}`);
    process.exit(2);
  }

  try {
    // Select representative real-data companies
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");

    const companyRows = await client.query(
      `SELECT company_id, COUNT(*) AS vc
       FROM vouchers
       WHERE deleted_at IS NULL AND optional = false
       GROUP BY company_id
       ORDER BY vc DESC
       LIMIT 3`,
    );
    const companies = companyRows.rows.map((r) => r.company_id);

    // Also get a historical date for the largest company
    let historicalDate = null;
    if (companies.length > 0) {
      const dRow = await client.query(
        `SELECT MIN(voucher_date) AS oldest, MAX(voucher_date) AS newest
         FROM vouchers
         WHERE company_id = $1 AND deleted_at IS NULL AND optional = false`,
        [companies[0]],
      );
      if (dRow.rows[0]?.oldest && dRow.rows[0]?.newest) {
        const oldestMs = new Date(dRow.rows[0].oldest).getTime();
        const newestMs = new Date(dRow.rows[0].newest).getTime();
        historicalDate = new Date(oldestMs + (newestMs - oldestMs) * 0.5).toISOString().slice(0, 10);
      }
    }

    await client.query("ROLLBACK");

    console.log("Program 6D — query plan collection");
    console.log(`Representative companies: ${companies.join(", ")}`);
    console.log(`Historical date (median): ${historicalDate ?? "none"}`);
    console.log("");

    const planResults = [];
    const scenariosToRun = [
      // Current date (no date filter) for each company
      ...companies.map((cid) => ({ companyId: cid, toDate: null })),
      // Historical date for first company
      ...(companies.length > 0 && historicalDate
        ? [{ companyId: companies[0], toDate: historicalDate }]
        : []),
    ];

    for (const { companyId, toDate } of scenariosToRun) {
      const queries = getQueries(companyId, toDate);
      for (const q of queries) {
        process.stdout.write(`  ${q.name} company=${companyId} date=${toDate ?? "current"} … `);
        const result = await collectPlan(client, q.name, q.sql, q.params, companyId, toDate);
        if (result.success) {
          const m = result.metrics;
          console.log(
            `plan=${m.planningTimeMs?.toFixed(2)}ms exec=${m.executionTimeMs?.toFixed(2)}ms ` +
            `rows=${m.actualRows} seqScans=${m.seqScans.length} idxScans=${m.indexScans.length}`,
          );
          planResults.push(result.metrics);
        } else {
          console.log(`ERROR: ${result.error}`);
          planResults.push(result);
        }
      }
    }

    // Performance comparison summary
    console.log("\n── Performance comparison ───────────────────────────────────────");
    for (const cid of companies) {
      const cur1 = planResults.find((p) => p.queryName === "current-ledger-entries"   && p.companyId === cid && p.toDate === "current");
      const cur2 = planResults.find((p) => p.queryName === "current-company-entries"  && p.companyId === cid && p.toDate === "current");
      const cnd1 = planResults.find((p) => p.queryName === "candidate-ledger-grouped" && p.companyId === cid && p.toDate === "current");
      const cnd2 = planResults.find((p) => p.queryName === "candidate-supplier-grouped" && p.companyId === cid && p.toDate === "current");
      const cnd3 = planResults.find((p) => p.queryName === "candidate-employee-grouped" && p.companyId === cid && p.toDate === "current");
      if (cur1 && cur2 && cnd1 && cnd2 && cnd3) {
        const currentTotal   = (cur1.executionTimeMs ?? 0) + (cur2.executionTimeMs ?? 0);
        const candidateTotal = (cnd1.executionTimeMs ?? 0) + (cnd2.executionTimeMs ?? 0) + (cnd3.executionTimeMs ?? 0);
        const currentRows    = (cur1.actualRows ?? 0) + (cur2.actualRows ?? 0);
        const candidateRows  = (cnd1.actualRows ?? 0) + (cnd2.actualRows ?? 0) + (cnd3.actualRows ?? 0);
        console.log(
          `  company=${cid}: current=${currentTotal.toFixed(2)}ms (${currentRows} rows) | ` +
          `candidate=${candidateTotal.toFixed(2)}ms (${candidateRows} rows)`,
        );
      }
    }

    const output = {
      program: "6D",
      collectedAt: new Date().toISOString(),
      companiesUsed: companies,
      historicalDate,
      totalPlansCollected: planResults.length,
      plans: planResults,
    };

    if (jsonOutputPath) {
      const outPath = resolve(process.cwd(), jsonOutputPath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
      console.log(`\nFull plans written to: ${outPath}`);
    }

    process.exit(0);
  } catch (err) {
    console.error(`Fatal error: ${err.message}`);
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
