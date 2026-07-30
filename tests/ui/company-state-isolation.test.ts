import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("frontend company-state isolation wiring", () => {
  it("routes every selector change through CompanyContext without reloading", () => {
    const selector = source("client/src/components/CompanySelector.tsx");

    expect(selector).toContain("await selectCompany(company");
    expect(selector).toContain("{ offline: true }");
    expect(selector).not.toContain("window.location.reload");
    expect(selector).not.toContain('apiRequest("POST", "/api/auth/set-company"');
  });

  it("serializes switches and clears previous-company requests and caches", () => {
    const context = source("client/src/contexts/CompanyContext.tsx");

    expect(context).toContain("createCompanySwitchQueue");
    expect(context).toContain("cancelCompanySessionQueries(queryClient)");
    expect(context).toContain("removeCompanySessionQueries(queryClient)");
    expect(context).toContain("const ok = await switchCompanyOnServer(company.id)");
    expect(context).toContain("commitCompanySelection(company, { prefetch: true, serverSynced: true })");
    expect(context).toContain("commitCompanySelection(company, { prefetch: false, serverSynced: false })");
    expect(context).toContain("scheduleInitialSyncRetry");
    expect(context).not.toContain("invalidateCompanyQueries");
  });

  it("blocks every authenticated workspace while the company session changes", () => {
    const app = source("client/src/app/AuthenticatedApp.tsx");
    const appData = source("client/src/app/useAuthenticatedAppData.ts");

    expect(app).toContain("if (companyLoading || !selectedCompany) return <AppLoadingState />;");
    expect(appData).toContain('companyQueryKey("/api/company-settings", selectedCompanyId)');
    expect(appData).toContain('companyQueryKey("/api/factory/my-access", selectedCompanyId)');
    expect(appData).toContain('companyQueryKey("/api/factory/settings", selectedCompanyId)');
  });

  it("scopes company-transfer history, account options, and rules", () => {
    const transfers = source("client/src/pages/CompanyTransfer.tsx");

    expect(transfers).toContain("companyKeys.simpleTransfers(fromCompanyId)");
    expect(transfers).toContain("companyKeys.companyAccounts(fromCompanyId, fromCompanyId)");
    expect(transfers).toContain("companyKeys.companyAccounts(fromCompanyId, ruleDestCompanyId || null)");
    expect(transfers).toContain("companyKeys.autoTransferConfig(fromCompanyId");
    expect(transfers).not.toContain('queryKey: ["/api/simple-company-transfers"]');
  });
});
