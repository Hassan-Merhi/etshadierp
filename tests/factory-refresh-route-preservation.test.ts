import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");

describe("Factory refresh route preservation", () => {
  it("waits for company restoration before evaluating Factory route redirects", () => {
    expect(source).toContain('const isFactoryRoute = currentLocation.startsWith("/factory/")');
    expect(source).toContain("if (isFactoryRoute && companyLoading) return <AppLoadingState />;");

    const loadingGuard = source.indexOf("if (isFactoryRoute && companyLoading)");
    const wrongCompanyRedirect = source.indexOf("if (isFactoryRoute && !isFactoryCompany && !myAccessLoading && hasErpAccess)");

    expect(loadingGuard).toBeGreaterThan(-1);
    expect(wrongCompanyRedirect).toBeGreaterThan(loadingGuard);
  });
});
