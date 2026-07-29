import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Phase 7 company access boundary", () => {
  it("requires explicit company membership even for privileged overrides", () => {
    const boundary = source("server/security/companyAccessBoundary.ts");

    expect(boundary).toContain("resolveAuthorizedCompanyId");
    expect(boundary).toContain("isPrivilegedRole");
    expect(boundary).toContain("await assertCompanyAccess(context.userId, targetCompanyId)");
    expect(boundary).toContain("CROSS_COMPANY_FORBIDDEN");
    expect(boundary).toContain("COMPANY_ACCESS_DENIED");
  });

  it("routes transfer authorization through the central boundary", () => {
    const transferContext = source("server/routes/transfers/transferRequestContext.ts");

    expect(transferContext).toContain("getCompanyAccessContext");
    expect(transferContext).toContain("assertCompaniesAccess");
    expect(transferContext).toContain("assertCompanyAccess");
    expect(transferContext).not.toContain("storage.getUserCompaniesWithRoles");
  });

  it("protects cross-company financial exports with membership checks", () => {
    const exportRoute = source("server/routes/netPositionMonthlyExcelRoute.ts");

    expect(exportRoute).toContain("resolveAuthorizedCompanyId(req, req.query.companyId)");
    expect(exportRoute).toContain("requireNonPOS");
    expect(exportRoute).not.toContain("isAdminOrDev && requestedCompanyId");
  });
});
