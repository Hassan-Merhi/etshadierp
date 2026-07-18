import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertRequestCompanyMatchesSession } from "../server/services/security/companyIsolationPolicy";

const routeSource = readFileSync(
  new URL("../server/routes/factory/factoryInsuranceRoutes.ts", import.meta.url),
  "utf8"
);

describe("factory insurance company isolation", () => {
  const actor = { userId: 1, role: "Admin", companyId: 10 };

  it("accepts the active session company", () => {
    expect(() => assertRequestCompanyMatchesSession(actor, 10)).not.toThrow();
  });

  it("denies a request-supplied cross-company id even for Admin", () => {
    expect(() => assertRequestCompanyMatchesSession(actor, 11)).toThrowError(/Not found|Forbidden/);
  });

  it("uses the canonical company-isolation policy in the production route", () => {
    expect(routeSource).toContain("assertRequestCompanyMatchesSession");
    expect(routeSource).toContain("resolveRequestCompanyId(req)");
  });

  it("does not select the operating company directly from request data", () => {
    expect(routeSource).not.toContain("req.body.companyId || getFactoryCompanyId(req)");
    expect(routeSource).not.toContain("req.query.companyId\n        ? parseInt");
  });

  it("keeps reads, writes, toggles, deletion, and generation scoped", () => {
    expect(routeSource.match(/resolveRequestCompanyId\(req\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(routeSource).toContain("eq(insuranceMembers.companyId, companyId)");
    expect(routeSource).toContain("eq(vouchers.companyId, companyId)");
  });
});
