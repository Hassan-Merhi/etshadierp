import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticatedUserQueryOptions,
  fetchAuthenticatedUser,
} from "../../client/src/contracts/sessionQueryContracts";
import { isExpectedUnauthenticatedProbe } from "../../client/src/lib/clientObservability";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticated request gating", () => {
  it("does not mount protected providers or widgets before /api/auth/me succeeds", () => {
    const app = source("client/src/App.tsx");
    const authenticatedRoot = app.indexOf("function AuthenticatedRoot()");
    const authQuery = app.indexOf("useAuthenticatedUser()", authenticatedRoot);
    const authLoadingGuard = app.indexOf("if (isLoading || error || !user)", authQuery);
    const companyProvider = app.indexOf("<CompanyProvider>", authLoadingGuard);

    expect(authenticatedRoot).toBeGreaterThan(-1);
    expect(authQuery).toBeGreaterThan(authenticatedRoot);
    expect(authLoadingGuard).toBeGreaterThan(authQuery);
    expect(companyProvider).toBeGreaterThan(authLoadingGuard);
    expect(app).toContain('if (!isLoading && !error && user === null) return <Redirect to="/login" />;');

    const publicAppTree = app.slice(app.indexOf("export default function App()"));
    expect(publicAppTree).not.toContain("<CompanyProvider>");
    expect(publicAppTree).not.toContain("<AuthenticatedChatWidget />");
    expect(publicAppTree).not.toContain("<AuthenticatedUserNotesPanel />");
    expect(publicAppTree).toContain("<AuthenticatedRoot />");
  });

  it("keeps transient auth failures recoverable instead of treating them as logout", async () => {
    const unauthorizedFetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", unauthorizedFetch);
    await expect(fetchAuthenticatedUser()).resolves.toBeNull();

    const unavailableFetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", unavailableFetch);
    await expect(fetchAuthenticatedUser()).rejects.toThrow("Failed to load authenticated user (503)");

    const options = authenticatedUserQueryOptions();
    expect(options.retry).toBe(3);
    expect(options.refetchOnReconnect).toBe(true);
  });

  it("keeps the unauthenticated login entry path quiet without hiding real API failures", () => {
    const languageProvider = source("client/src/contexts/ApplicationLanguageContext.tsx");
    const app = source("client/src/App.tsx");

    // Asserted through the contract rather than the source of
    // useAuthenticatedUser.ts. That file only *describes* the guard in a
    // comment — the implementation is authenticatedUserQueryOptions() — so a
    // toContain against it matched the comment and would have kept passing if
    // the guard itself were deleted.
    const originalPath = window.location.pathname;
    try {
      window.history.replaceState({}, "", "/login");
      expect(authenticatedUserQueryOptions().enabled).toBe(false);
      window.history.replaceState({}, "", "/login/reset");
      expect(authenticatedUserQueryOptions().enabled).toBe(false);
      window.history.replaceState({}, "", "/dashboard");
      expect(authenticatedUserQueryOptions().enabled).toBe(true);
    } finally {
      window.history.replaceState({}, "", originalPath);
    }

    expect(languageProvider).toContain("enabled: !isLoginRoute");
    expect(app).toContain('<Route path="/login">');
    expect(app).toContain("<Login />");

    expect(
      isExpectedUnauthenticatedProbe({
        status: 401,
        url: "/api/auth/me",
        message: "Unauthorized",
      })
    ).toBe(true);
    expect(
      isExpectedUnauthenticatedProbe({
        status: 401,
        url: "/api/customers",
        message: "Unauthorized",
      })
    ).toBe(false);
    expect(
      isExpectedUnauthenticatedProbe({
        status: 503,
        url: "/api/auth/me",
        message: "Service unavailable",
      })
    ).toBe(false);
  });

  it("passes the already-verified user into the authenticated workspace", () => {
    const authenticatedApp = source("client/src/app/AuthenticatedApp.tsx");

    expect(authenticatedApp).toContain("interface AuthenticatedAppProps");
    expect(authenticatedApp).toContain(
      "export function AuthenticatedApp({ user, handleLogout }: AuthenticatedAppProps)"
    );
    expect(authenticatedApp).not.toContain("useAuthenticatedUser(");
    expect(authenticatedApp).toContain("userPresent: true");
  });

  it("keeps presence disabled when its authenticated owner is disabled", () => {
    const presence = source("client/src/hooks/use-presence.ts");

    expect(presence).toContain("export function usePresence(enabled = true)");
    expect(presence).toContain("if (!enabled) return;");
    expect(presence).toContain("if (!enabled) {");
    expect(presence).toContain("[enabled, location, sendHeartbeat]");
    expect(presence).toContain("[enabled, sendHeartbeat]");
  });
});
