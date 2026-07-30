import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authenticatedApp = readFileSync("client/src/app/AuthenticatedApp.tsx", "utf8");
const routeGuard = readFileSync("client/src/app/authenticatedAppRouteGuard.ts", "utf8");

describe("Factory refresh route preservation", () => {
  it("waits for authentication and company restoration before resolving routes", () => {
    const loadingGuard = authenticatedApp.indexOf(
      "if (isLoading || companyLoading || !selectedCompany) return <AppLoadingState />",
    );
    const routeResolution = authenticatedApp.indexOf("const routeState = resolveAuthenticatedAppRoute");

    expect(loadingGuard).toBeGreaterThan(-1);
    expect(routeResolution).toBeGreaterThan(loadingGuard);
  });

  it("keeps Factory-company navigation pending while access restoration is incomplete", () => {
    expect(routeGuard).toContain('if (myAccessLoading) decision = { kind: "loading" }');
    expect(routeGuard).toContain(
      'else if (myAccess === undefined && !myAccessError) decision = { kind: "empty" }',
    );
    expect(routeGuard).toContain('else decision = { kind: "redirect", to: factoryDefaultPage }');
  });

  it("only returns an ERP-company user from a Factory route after access loading completes", () => {
    expect(routeGuard).toContain(
      "isFactoryRoute && !isFactoryCompany && !myAccessLoading && hasErpAccess",
    );
    expect(routeGuard).toContain('decision = { kind: "redirect", to: "/" }');
  });
});
