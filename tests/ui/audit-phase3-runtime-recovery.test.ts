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

  it("redirects to sign-in only on a confirmed unauthenticated response, never on a transient error", () => {
    const app = source("client/src/App.tsx");

    // Confirmed unauthenticated (isSuccess with a null user) is the ONLY logout trigger.
    expect(app).toContain('if (isSuccess && user === null) return <Redirect to="/login" />;');
    // A transient error or slow startup must surface a recoverable state, not a redirect.
    expect(app).toContain("if (error || loadingTimedOut)");
    expect(app).toContain("<AppLoadingState forceRecovery");
    // The pre-Phase-3 speculative-logout expression must not come back.
    expect(app).not.toContain("loadingTimedOut || (!isLoading && (error || !user))");
    // The whole authenticated tree is wrapped so a render/provider crash is visible.
    expect(app).toContain("<ErrorBoundary>");
    expect(app).toContain("<AuthenticatedRoot />");
  });

  it("never returns a blank React tree for a Factory access contract", () => {
    // Missing-but-not-errored access is still resolving -> spinner, not a blank tree.
    const missingAccess = resolveAuthenticatedAppRoute({
      currentLocation: "/",
      companyType: "factory",
      isAdminOwner: false,
      myAccess: undefined,
      myAccessLoading: false,
      myAccessError: false,
      factorySettings: {},
    });
    expect(missingAccess.decision).toEqual({ kind: "loading" });

    // A failed access contract degrades to the fallback Factory landing page
    // instead of blanking the page.
    const failedAccess = resolveAuthenticatedAppRoute({
      currentLocation: "/",
      companyType: "factory",
      isAdminOwner: false,
      myAccess: undefined,
      myAccessLoading: false,
      myAccessError: true,
      factorySettings: {},
    });
    expect(failedAccess.decision.kind).toBe("redirect");

    // The blank "empty" decision kind must not exist anywhere.
    const guard = source("client/src/app/authenticatedAppRouteGuard.ts");
    expect(guard).not.toContain('kind: "empty"');
    expect(guard).not.toContain('| { kind: "empty" }');
  });

  it("scopes the Factory access/settings gate to the Factory workspace only (the outage regression guard)", () => {
    const authenticatedApp = source("client/src/app/AuthenticatedApp.tsx");

    // The universal access gate that blocked every non-Factory ERP company on
    // /api/factory/my-access is the exact change that took production down. It
    // must never come back.
    expect(authenticatedApp).not.toContain("usesAccessContract");

    // Factory access/settings recovery must live inside the Factory workspace
    // branch, i.e. after the route decision has classified this as a Factory
    // route/company — never before it as a startup-wide gate.
    const factoryBranch = authenticatedApp.indexOf("routeState.isFactoryRoute || routeState.isFactoryCompany");
    const myAccessGate = authenticatedApp.indexOf("if (myAccessError)");
    const factorySettingsGate = authenticatedApp.indexOf("if (factorySettingsError)");
    expect(factoryBranch).toBeGreaterThan(-1);
    expect(myAccessGate).toBeGreaterThan(factoryBranch);
    expect(factorySettingsGate).toBeGreaterThan(factoryBranch);

    // No route guard branch renders a blank tree.
    expect(authenticatedApp).not.toContain('decision.kind === "empty"');
    expect(authenticatedApp).not.toContain("return null;");
  });

  it("recovers company bootstrap failures with bounded retries instead of loading forever", () => {
    const authenticatedApp = source("client/src/app/AuthenticatedApp.tsx");
    const companyContext = source("client/src/contexts/CompanyContext.tsx");

    expect(authenticatedApp).toContain("if (companyLoading) return <AppLoadingState />;");
    expect(authenticatedApp).toContain("if (companyError || !selectedCompany)");
    expect(authenticatedApp).toContain("retryCompanyBootstrap");

    expect(companyContext).toContain("MAX_INITIAL_SYNC_FAILURES = 3");
    expect(companyContext).toContain("initialSyncError");
    expect(companyContext).toContain("retry: () => Promise<void>");
  });

  it("surfaces Factory settings failures instead of faking an empty configuration", () => {
    const appData = source("client/src/app/useAuthenticatedAppData.ts");

    expect(appData).not.toContain("response.ok ? response.json() : {}");
    expect(appData).toContain('if (!response.ok) throw new Error(String(response.status));');
    expect(appData).toContain("factorySettingsError");
    expect(appData).toContain("retryFactorySettings");
    expect(appData).toContain("retryMyAccess");
  });
});
