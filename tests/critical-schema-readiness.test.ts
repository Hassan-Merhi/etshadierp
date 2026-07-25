import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  criticalColumns,
  criticalIndexes,
  criticalTables,
  evaluateCriticalSchema,
} from "../server/criticalSchemaReadiness.mjs";

function completeSnapshot() {
  return {
    tables: [...criticalTables],
    columns: criticalColumns.map(([tableName, columnName]) => ({ tableName, columnName })),
    indexes: [...criticalIndexes],
  };
}

describe("critical schema readiness", () => {
  it("reports ready only when all required schema objects exist", () => {
    expect(evaluateCriticalSchema(completeSnapshot())).toEqual({
      ok: true,
      missingTables: [],
      missingColumns: [],
      missingIndexes: [],
    });
  });

  it("reports the exact missing table, column, and index", () => {
    const snapshot = completeSnapshot();
    snapshot.tables = snapshot.tables.filter((tableName) => tableName !== "fiscal_period_closures");
    snapshot.columns = snapshot.columns.filter(
      ({ tableName, columnName }) => !(tableName === "voucher_entries" && columnName === "base_debit_amount"),
    );
    snapshot.indexes = snapshot.indexes.filter(
      (indexName) => indexName !== "exchange_rates_company_date_pair_unique",
    );

    expect(evaluateCriticalSchema(snapshot)).toEqual({
      ok: false,
      missingTables: ["fiscal_period_closures"],
      missingColumns: ["voucher_entries.base_debit_amount"],
      missingIndexes: ["exchange_rates_company_date_pair_unique"],
    });
  });

  it("keeps Render on the schema-aware readiness endpoint", () => {
    const renderYaml = fs.readFileSync(path.resolve(process.cwd(), "render.yaml"), "utf8");
    const runtimeGuard = fs.readFileSync(
      path.resolve(process.cwd(), "server/runtimeHealthGuard.mjs"),
      "utf8",
    );

    expect(renderYaml).toContain("healthCheckPath: /api/health/ready");
    expect(runtimeGuard).toContain("database.schema?.ok === true");
    expect(runtimeGuard).toContain("evaluateCriticalSchema");
  });
});
