import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function functionBody(source: string, functionName: string): string {
  const start = source.indexOf(`export async function ${functionName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe("Phase 4 hot-path performance regressions", () => {
  it("targets a single cash/bank account instead of rebuilding company-wide revaluation", () => {
    const source = read("server/services/accounting/cashBankRevaluationService.ts");
    const singleAccountPath = functionBody(source, "getCashBankAccountSummary");

    expect(singleAccountPath).toContain("loadSingleAccount(companyId, accountKind, accountId)");
    expect(singleAccountPath).toContain("loadAggregates(companyId, accountKind, [accountId])");
    expect(singleAccountPath).not.toContain("getCashBankRevaluation(companyId)");
  });

  it("aggregates /api/accounts/all movements in PostgreSQL instead of materializing voucher rows", () => {
    const source = read("server/routes/accounts/all.ts");

    expect(source).toContain("voucherEntries.fixedAssetId");
    expect(source).toContain("voucherEntries.employeeId");
    expect(source).toContain(".groupBy(");
    expect(source).not.toContain("companyVoucherIds");
    expect(source).not.toContain("const allEntries =");
    expect(source).toContain("suppliers.length === 0");
  });

  it("keeps bale-scan success-path lookups bounded", () => {
    const source = read("server/routes/factory/customer-orders/bale-scanning/scan.ts");

    expect(source).not.toContain("matchingProductsByName");
    expect(source).not.toContain("const [alreadyAdded]");
    expect(source).toContain("reservedInThisOrder");
    expect(source).toContain("const activeOrderCheck");
    expect(source).toContain("const currentCountExpression = enforceOverload");
    expect(source).toContain("currentCount: currentCountExpression");
    expect(source).toContain(': sql<number>`0`;');
    expect(source).toContain("isNull(customerOrders.deletedAt)");
  });
});
