import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(new URL("./spGoldenCoastSetupRoutes.ts", import.meta.url), "utf8");
const spSetupSource = readFileSync(new URL("./spSetupRoutes.ts", import.meta.url), "utf8");
const spIndexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("Golden Coast Phase 2 setup route surface", () => {
  it("registers provisioning and status inside the Supplier Partner setup area", () => {
    expect(routeSource).toContain('"/api/sp/setup/golden-coast"');
    expect(routeSource).toContain('"/api/sp/setup/golden-coast/status"');
    expect(spIndexSource).toContain("registerSpGoldenCoastSetupRoutes(app);");
  });

  it("restricts provisioning to authenticated Admins on a supplier_partner company", () => {
    expect(routeSource).toContain("requireAuth");
    expect(routeSource).toContain('requireRole("Admin")');
    expect(routeSource).toContain("requireSpCompany(req, res)");
  });

  it("rate limits both endpoints and caps the provisioning request body", () => {
    // Provisioning runs a multi-table transaction and the status read scans the
    // company chart of accounts, so neither may be called without a limiter.
    expect(routeSource).toContain("privilegedMutationRateLimit");
    expect(routeSource).toContain("privilegedReadRateLimit");
    expect(routeSource).toContain("goldenCoastRequestBudget");
  });

  it("scopes every ledger read and write to the selected company", () => {
    expect(routeSource).toContain("eq(ledgerAccounts.companyId, companyId)");
    expect(routeSource).toContain("eq(companySettings.companyId, companyId)");
    // The repair update is keyed on both the account id and the company id so a
    // stale plan can never touch another tenant's ledger.
    expect(routeSource).toContain(
      "and(eq(ledgerAccounts.id, item.accountId), eq(ledgerAccounts.companyId, companyId))"
    );
  });

  it("never deletes or soft-deletes ledger accounts or vouchers during setup", () => {
    expect(routeSource).not.toContain(".delete(");
    expect(routeSource).not.toContain("vouchers");
    expect(routeSource).not.toContain("voucherEntries");
  });

  it("applies provisioning atomically", () => {
    expect(routeSource).toContain("db.transaction(");
  });

  it("surfaces Golden Coast status from the existing SP setup status endpoint", () => {
    expect(spSetupSource).toContain("summarizeGoldenCoastAccountSetup");
    expect(spSetupSource).toContain("goldenCoast,");
  });
});
