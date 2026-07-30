import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");
const guard = readFileSync("client/src/app/authenticatedAppRouteGuard.ts", "utf8");

describe("Factory refresh route preservation", () => {
  it("waits for company restoration before evaluating Factory route redirects", () => {
    // The authenticated shell must block on company loading before it resolves
    // any route decision, so a hard refresh on a Factory URL never redirects
    // away while the active company is still being restored.
    expect(app).toContain("const { selectedCompany, isLoading: companyLoading } = useCompany();");
    expect(app).toContain("if (isLoading || companyLoading || !selectedCompany || !user) return <AppLoadingState />;");

    const companyGuard = app.indexOf("companyLoading || !selectedCompany");
    const routeResolution = app.indexOf("resolveAuthenticatedAppRoute({");
    expect(companyGuard).toBeGreaterThan(-1);
    expect(routeResolution).toBeGreaterThan(companyGuard);
  });

  it("classifies Factory routes and only redirects a wrong-company Factory URL", () => {
    expect(guard).toContain('const isFactoryRoute = currentLocation.startsWith("/factory/");');
    expect(guard).toContain("isFactoryRoute && !isFactoryCompany && !myAccessLoading && hasErpAccess");
  });
});
