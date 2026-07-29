import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("Phase 9 type-safety wiring", () => {
  it("validates the authenticated user response from unknown", () => {
    const hook = source("client/src/app/useAuthenticatedUser.ts");

    expect(hook).toContain("useQuery<AuthenticatedUser | null>");
    expect(hook).toContain("parseAuthenticatedUser(value)");
    expect(hook).not.toContain("useQuery<any>");
    expect(hook).toContain("logoutError: unknown");
  });

  it("validates company assignments and session-company responses", () => {
    const context = source("client/src/contexts/CompanyContext.tsx");

    expect(context).toContain("useQuery<UserCompanyAssignment[]>");
    expect(context).toContain("parseUserCompanies(value)");
    expect(context).toContain("parseSessionCompany(value)");
    expect(context).not.toContain("useQuery<any[]>");
    expect(context).toContain("export interface Company");
    expect(context).toContain("createCompanySwitchQueue");
  });

  it("removes unsafe company selector casts without bypassing context switching", () => {
    const selector = source("client/src/components/CompanySelector.tsx");

    expect(selector).toContain("company: Company");
    expect(selector).toContain("error: unknown");
    expect(selector).toContain("await selectCompany(company");
    expect(selector).not.toContain("company: any");
    expect(selector).not.toContain("as any");
    expect(selector).not.toContain("error: any");
    expect(selector).not.toContain("window.location.reload");
  });
});
