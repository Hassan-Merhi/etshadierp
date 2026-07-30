import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Phase 12 test coverage and reliability contracts", () => {
  it("keeps smoke, domain and full regression boundaries deterministic", () => {
    const runner = source("scripts/run-phase12-business-regression.mjs");
    for (const marker of [
      "const backendDomains",
      "const frontendDomains",
      'process.argv.find((argument) => argument.startsWith("--domain="))',
      'process.argv.includes("--smoke")',
      'process.argv.includes("--list")',
      '"--maxWorkers=1"',
      '"--no-file-parallelism"',
      '"vitest.config.frontend.ts"',
    ]) {
      expect(runner).toContain(marker);
    }
  });

  it("covers every critical business domain", () => {
    const runner = source("scripts/run-phase12-business-regression.mjs");
    for (const suite of [
      "tests/workflow.test.ts",
      "tests/factory-container-lifecycle.test.ts",
      "tests/accounting.test.ts",
      "tests/central-posting-engine.test.ts",
      "tests/payment-receipt-posting.test.ts",
      "tests/pos.test.ts",
      "tests/vouchers.test.ts",
      "tests/inventory.test.ts",
      "tests/inventory-hardening.test.ts",
      "tests/inventory-cost-memory-legacy-regression.test.ts",
      "tests/reports.test.ts",
      "tests/company-context-enforcement.test.ts",
      "tests/program-5-end-to-end-security.test.ts",
      "tests/factory-mix-batch-stable-cost.test.ts",
      "tests/factory-raw-material-moving-avg.test.ts",
      "tests/ui/authenticated-app-route-guard.test.ts",
    ]) {
      expect(runner).toContain(suite);
    }
  });

  it("enforces measured backend and frontend coverage on critical policy modules", () => {
    const backend = source("vitest.config.ts");
    const frontend = source("vitest.config.frontend.ts");

    expect(backend).toContain("lines: 10");
    expect(backend).toContain("statements: 10");
    expect(backend).toContain('"server/services/security/companyContextPolicy.ts"');
    expect(backend).toContain('"server/services/accounting/customerLinkedLedgerValidation.ts"');

    expect(frontend).toContain('"client/src/app/authenticatedAppRouteGuard.ts"');
    expect(frontend).toContain('"client/src/app/factoryAccessGuard.ts"');
    expect(frontend).toContain("functions: 100");
  });

  it("keeps company isolation policy pure and the Express adapter thin", () => {
    const policy = source("server/services/security/companyContextPolicy.ts");
    const adapter = source("server/services/security/companyContextEnforcementAdapter.ts");

    expect(policy).toContain("parsePositiveCompanyId");
    expect(policy).toContain("collectCompanyAssertions");
    expect(policy).toContain("decideExplicitCompanyContext");
    expect(policy).not.toContain('from "express"');

    expect(adapter).toContain('from "./companyContextPolicy"');
    expect(adapter).not.toContain("function positiveInteger");
    expect(adapter).not.toContain("function assertionValues");
  });

  it("protects route behavior with runtime tests rather than only source strings", () => {
    const routeMatrix = source("tests/ui/authenticated-app-route-guard.test.ts");
    expect(routeMatrix).toContain("resolveAuthenticatedAppRoute");
    expect(routeMatrix).toContain("computeFactoryDefaultPage");
    expect(routeMatrix).toContain("computeFactoryGuardRedirect");
    expect(routeMatrix).toContain("canonicalizes Properties route");
    expect(routeMatrix).toContain("rejects Supplier Partner routes");
    expect(routeMatrix).toContain("enforces feature flags");
  });

  it("freezes critical skip and todo debt while requiring active replacements", () => {
    const debt = JSON.parse(source("config/critical-test-debt.json"));
    expect(Object.keys(debt.criticalFiles)).toEqual([
      "tests/inventory.test.ts",
      "tests/factory-container-lifecycle.test.ts",
    ]);
    expect(debt.criticalFiles["tests/inventory.test.ts"].skips).toHaveLength(6);
    expect(debt.criticalFiles["tests/factory-container-lifecycle.test.ts"].todos).toHaveLength(3);
    expect(debt.activeReplacements["tests/inventory-cost-memory-legacy-regression.test.ts"]).toHaveLength(4);
    expect(debt.activeReplacements["tests/inventory-hardening.test.ts"]).toHaveLength(1);

    const verifier = source("scripts/verify-critical-test-debt.mjs");
    expect(verifier).toContain("unapproved ${kind}");
    expect(verifier).toContain("replacement is still skipped or todo");
  });

  it("aligns legacy inventory coverage with the authoritative cost-memory policy", () => {
    const policy = source("docs/inventory-cost-memory-policy.md");
    const regression = source("tests/inventory-cost-memory-legacy-regression.test.ts");

    expect(policy).toContain("averageRate may preserve the last valid non-negative rate");
    expect(policy).toContain("Do not change `server/inventoryHelper.ts`");
    expect(regression).toContain("zero asset value and non-negative cost memory");
    expect(regression).toContain("without accumulating phantom inventory value");
  });
});
