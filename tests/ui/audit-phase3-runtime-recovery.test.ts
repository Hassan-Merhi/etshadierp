import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedUserQueryOptions,
  fetchAuthenticatedUser,
} from "../../client/src/contracts/sessionQueryContracts";
import { resolveAuthenticatedAppRoute } from "../../client/src/app/authenticatedAppRouteGuard";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Audit Phase 3 runtime recovery", () => {
  it("treats only a confirmed 401 session response as unauthenticated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })));

    await expect(fetchAuthenticatedUser()).resolves.toBeNull();
  });

  it("keeps transient auth failures recoverable instead of converting them to logout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })));

    await expect(fetchAuthenticatedUser()).rejects.toThrow("503");

    const options = authenticatedUserQueryOptions();
    expect(options.retry).toBe(2);
    expect(options.refetchOnReconnect).toBe(true);
  });

  it("uses an explicit recovery decision instead of a blank route result", () => {
    const missingAccess = resolveAuthenticatedAppRoute({
      currentLocation: "/",
      companyType: "factory",
      isAdminOwner: false,
      myAccess: undefined,
      myAccessLoading: false,
      myAccessError: false,
      factorySettings: {},
    });
    const failedAccess = resolveAuthenticatedAppRoute({
      currentLocation: "/",
      companyType: "factory",
      isAdminOwner: false,
      myAccess: undefined,
      myAccessLoading: false,
      myAccessError: true,
      factorySettings: {},
    });

    expect(missingAccess.decision).toEqual({ kind: "recovery" });
    expect(failedAccess.decision).toEqual({ kind: "recovery" });
  });

  it("pins top-level crash, company, access, and settings recovery contracts", () => {
    const app = source("client/src/App.tsx");
    const authenticatedApp = source("client/src/app/AuthenticatedApp.tsx");
    const companyContext = source("client/src/contexts/CompanyContext.tsx");
    const appData = source("client/src/app/useAuthenticatedAppData.ts");
    const routeGuard = source("client/src/app/authenticatedAppRouteGuard.ts");

    expect(app).toContain("<ErrorBoundary>");
    expect(app).toContain("isSuccess && user === null");
    expect(app).toContain("forceRecovery onRecover={() => void retryAuthentication()}");

    expect(authenticatedApp).toContain("companyError || !selectedCompany");
    expect(authenticatedApp).toContain("retryCompanyBootstrap");
    expect(authenticatedApp).toContain("retryMyAccess");
    expect(authenticatedApp).toContain("retryFactorySettings");
    expect(authenticatedApp).not.toContain('decision.kind === "empty"');
    expect(authenticatedApp).not.toContain("return null;");

    expect(companyContext).toContain("MAX_INITIAL_SYNC_FAILURES = 3");
    expect(companyContext).toContain("initialSyncError");
    expect(companyContext).toContain("retry: () => Promise<void>");

    expect(appData).toContain("factorySettingsError");
    expect(appData).toContain("retryFactorySettings");
    expect(appData).not.toContain("response.ok ? response.json() : {}");

    expect(routeGuard).toContain('| { kind: "recovery" }');
    expect(routeGuard).not.toContain('| { kind: "empty" }');
  });
});
