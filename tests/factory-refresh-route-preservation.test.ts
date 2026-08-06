import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");
const guard = readFileSync("client/src/app/authenticatedAppRouteGuard.ts", "utf8");

describe("Factory refresh route preservation", () => {
  it("waits for company restoration before evaluating Factory route redirects", () => {
    expect(app).toContain("isLoading: companyLoading");
    expect(app).toContain("if (companyLoading) return <AppLoadingState />;");
    expect(app).toContain("if (companyError || !selectedCompany)");
    expect(app).toContain("retryCompanyBootstrap");
    const companyGuard = app.indexOf("if (companyLoading) return <AppLoadingState />;");
    const routeResolution = app.indexOf("resolveAuthenticatedAppRoute({");
    expect(companyGuard).toBeGreaterThan(-1);
    expect(routeResolution).toBeGreaterThan(companyGuard);
  });

  it("classifies Factory routes and only redirects a wrong-company Factory URL", () => {
    expect(guard).toContain('const isFactoryRoute = currentLocation.startsWith("/factory/");');
    expect(guard).toContain("isFactoryRoute && !isFactoryCompany");
    expect(guard).toContain('decision = { kind: "redirect", to: "/" };');
  });
});
