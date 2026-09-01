#!/usr/bin/env node

import process from "node:process";
import { Client } from "pg";

export const TENANT_CONTROL_AUDIT_CHECKS = [
  {
    key: "duplicate_user_company_roles",
    severity: "error",
    sql: `
      SELECT user_id, company_id, COUNT(*)::int AS row_count
      FROM user_company_roles
      GROUP BY user_id, company_id
      HAVING COUNT(*) > 1
      ORDER BY company_id, user_id
    `,
  },
  {
    key: "orphan_user_company_roles",
    severity: "error",
    sql: `
      SELECT ucr.id, ucr.user_id, ucr.company_id,
             (u.id IS NULL) AS missing_user,
             (c.id IS NULL) AS missing_company
      FROM user_company_roles ucr
      LEFT JOIN users u ON u.id = ucr.user_id
      LEFT JOIN companies c ON c.id = ucr.company_id
      WHERE u.id IS NULL OR c.id IS NULL
      ORDER BY ucr.id
    `,
  },
  {
    key: "user_role_location_company_mismatch",
    severity: "error",
    sql: `
      SELECT ucr.id, ucr.user_id, ucr.company_id, ucr.assigned_location_id,
             l.company_id AS location_company_id
      FROM user_company_roles ucr
      LEFT JOIN locations l ON l.id = ucr.assigned_location_id
      WHERE ucr.assigned_location_id IS NOT NULL
        AND (l.id IS NULL OR l.company_id <> ucr.company_id)
      ORDER BY ucr.id
    `,
  },
  {
    key: "user_role_cash_company_mismatch",
    severity: "error",
    sql: `
      SELECT ucr.id, ucr.user_id, ucr.company_id, ucr.cash_account_id,
             la.company_id AS account_company_id,
             la.account_type,
             la.active,
             la.deleted_at
      FROM user_company_roles ucr
      LEFT JOIN ledger_accounts la ON la.id = ucr.cash_account_id
      WHERE ucr.cash_account_id IS NOT NULL
        AND (la.id IS NULL OR la.company_id <> ucr.company_id)
      ORDER BY ucr.id
    `,
  },
  {
    key: "user_role_cash_not_active_cash",
    severity: "warning",
    sql: `
      SELECT ucr.id, ucr.user_id, ucr.company_id, ucr.cash_account_id,
             la.account_type, la.active, la.deleted_at
      FROM user_company_roles ucr
      JOIN ledger_accounts la ON la.id = ucr.cash_account_id
      WHERE ucr.cash_account_id IS NOT NULL
        AND (la.account_type <> 'Cash' OR la.active IS NOT TRUE OR la.deleted_at IS NOT NULL)
      ORDER BY ucr.id
    `,
  },
  {
    key: "invalid_user_locations",
    severity: "error",
    sql: `
      SELECT ul.id, ul.user_id, ul.company_id, ul.location_id,
             u.id IS NULL AS missing_user,
             c.id IS NULL AS missing_company,
             l.company_id AS location_company_id,
             ucr.id IS NULL AS missing_company_role
      FROM user_locations ul
      LEFT JOIN users u ON u.id = ul.user_id
      LEFT JOIN companies c ON c.id = ul.company_id
      LEFT JOIN locations l ON l.id = ul.location_id
      LEFT JOIN user_company_roles ucr
        ON ucr.user_id = ul.user_id AND ucr.company_id = ul.company_id
      WHERE u.id IS NULL
         OR c.id IS NULL
         OR l.id IS NULL
         OR l.company_id <> ul.company_id
         OR ucr.id IS NULL
      ORDER BY ul.id
    `,
  },
  {
    key: "duplicate_user_locations",
    severity: "warning",
    sql: `
      SELECT user_id, company_id, location_id, COUNT(*)::int AS row_count
      FROM user_locations
      GROUP BY user_id, company_id, location_id
      HAVING COUNT(*) > 1
      ORDER BY company_id, user_id, location_id
    `,
  },
  {
    key: "invalid_user_location_cash_accounts",
    severity: "error",
    sql: `
      SELECT ulca.id, ulca.user_id, ulca.company_id, ulca.location_id,
             ulca.cash_account_id,
             u.id IS NULL AS missing_user,
             c.id IS NULL AS missing_company,
             l.company_id AS location_company_id,
             la.company_id AS account_company_id,
             la.account_type,
             la.active,
             la.deleted_at,
             ucr.id IS NULL AS missing_company_role,
             ul.id IS NULL AS missing_location_assignment
      FROM user_location_cash_accounts ulca
      LEFT JOIN users u ON u.id = ulca.user_id
      LEFT JOIN companies c ON c.id = ulca.company_id
      LEFT JOIN locations l ON l.id = ulca.location_id
      LEFT JOIN ledger_accounts la ON la.id = ulca.cash_account_id
      LEFT JOIN user_company_roles ucr
        ON ucr.user_id = ulca.user_id AND ucr.company_id = ulca.company_id
      LEFT JOIN user_locations ul
        ON ul.user_id = ulca.user_id
       AND ul.company_id = ulca.company_id
       AND ul.location_id = ulca.location_id
      WHERE u.id IS NULL
         OR c.id IS NULL
         OR l.id IS NULL
         OR l.company_id <> ulca.company_id
         OR la.id IS NULL
         OR la.company_id <> ulca.company_id
         OR la.account_type <> 'Cash'
         OR la.active IS NOT TRUE
         OR la.deleted_at IS NOT NULL
         OR ucr.id IS NULL
         OR ul.id IS NULL
      ORDER BY ulca.id
    `,
  },
  {
    key: "orphan_role_feature_permissions",
    severity: "error",
    sql: `
      SELECT rfp.id, rfp.company_id, rfp.role, rfp.feature_key
      FROM role_feature_permissions rfp
      LEFT JOIN companies c ON c.id = rfp.company_id
      WHERE c.id IS NULL
      ORDER BY rfp.id
    `,
  },
  {
    key: "invalid_user_security_permissions",
    severity: "error",
    sql: `
      SELECT usp.id, usp.user_id, usp.company_id, usp.permission,
             u.id IS NULL AS missing_user,
             c.id IS NULL AS missing_company,
             ucr.id IS NULL AS missing_company_role
      FROM user_security_permissions usp
      LEFT JOIN users u ON u.id = usp.user_id
      LEFT JOIN companies c ON c.id = usp.company_id
      LEFT JOIN user_company_roles ucr
        ON ucr.user_id = usp.user_id AND ucr.company_id = usp.company_id
      WHERE u.id IS NULL OR c.id IS NULL OR ucr.id IS NULL
      ORDER BY usp.id
    `,
  },
];

export function summarizeTenantControlAudit(results) {
  const summary = {
    ok: true,
    errorCount: 0,
    warningCount: 0,
    checks: [],
  };

  for (const result of results) {
    const count = Number(result.rows?.length ?? result.count ?? 0);
    summary.checks.push({ key: result.key, severity: result.severity, count });
    if (count > 0 && result.severity === "error") summary.errorCount += count;
    if (count > 0 && result.severity === "warning") summary.warningCount += count;
  }
  summary.ok = summary.errorCount === 0;
  return summary;
}

async function main() {
  const jsonOutput = process.argv.includes("--json");
  const sampleLimitArg = process.argv.find((arg) => arg.startsWith("--sample-limit="));
  const sampleLimit = Math.min(100, Math.max(0, Number(sampleLimitArg?.split("=")[1] ?? 20) || 20));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required for the read-only tenant integrity audit.");
    process.exitCode = 2;
    return;
  }

  const isLocalReplitDb = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  const client = new Client({
    connectionString,
    ssl: !isLocalReplitDb && !sslExplicitlyDisabled ? { rejectUnauthorized: false } : false,
  });

  const results = [];
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    for (const check of TENANT_CONTROL_AUDIT_CHECKS) {
      const result = await client.query(check.sql);
      results.push({
        key: check.key,
        severity: check.severity,
        count: result.rowCount ?? result.rows.length,
        rows: result.rows.slice(0, sampleLimit),
      });
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Tenant control integrity audit failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  } finally {
    await client.end().catch(() => {});
  }

  const summary = summarizeTenantControlAudit(results);
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ ...summary, results }, null, 2)}\n`);
  } else {
    console.log("Tenant control integrity audit (read-only)");
    for (const result of results) {
      const marker = result.count === 0 ? "OK" : result.severity === "error" ? "ERROR" : "WARN";
      console.log(`${marker} ${result.key}: ${result.count}`);
      if (result.rows.length > 0) console.log(JSON.stringify(result.rows, null, 2));
    }
    console.log(
      summary.ok
        ? `Audit passed with ${summary.warningCount} warning row(s).`
        : `Audit found ${summary.errorCount} error row(s) and ${summary.warningCount} warning row(s).`
    );
  }

  process.exitCode = summary.ok ? 0 : 1;
}

await main();
