import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

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
    expect(app).not.toContain("loadingTimedOut ||");

    const publicAppTree = app.slice(app.indexOf("export default function App()"));
    expect(publicAppTree).not.toContain("<CompanyProvider>");
    expect(publicAppTree).not.toContain("<AuthenticatedChatWidget />");
    expect(publicAppTree).not.toContain("<AuthenticatedUserNotesPanel />");
    expect(publicAppTree).toContain("<AuthenticatedRoot />");
  });

  it("keeps transient auth failures recoverable instead of treating them as logout", () => {
    const authHook = source("client/src/app/useAuthenticatedUser.ts");
    const queryContracts = source("client/src/contracts/sessionQueryContracts.ts");

    expect(authHook).not.toContain("setLoadingTimedOut");
    expect(authHook).not.toContain("12000");
    expect(queryContracts).toContain("if (response.status === 401) return null;");
    expect(queryContracts).toContain("retry: 3");
    expect(queryContracts).toContain("refetchOnReconnect: true");
  });

  it("passes the already-verified user into the authenticated workspace", () => {
    const authenticatedApp = source("client/src/app/AuthenticatedApp.tsx");

    expect(authenticatedApp).toContain("interface AuthenticatedAppProps");
    expect(authenticatedApp).toContain("export function AuthenticatedApp({ user, handleLogout }: AuthenticatedAppProps)");
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
