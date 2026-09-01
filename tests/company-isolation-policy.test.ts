import { describe, expect, it, vi } from "vitest";
import {
  CompanyIsolationError,
  assertRequestCompanyMatchesSession,
  authorizeCompanyScopedResourceTx,
  type CompanyIsolationRequest,
} from "../server/services/security/companyIsolationPolicy";

function request(overrides: Partial<CompanyIsolationRequest> = {}): CompanyIsolationRequest {
  return {
    tx: { id: "tx" },
    actor: {
      userId: 1,
      role: "Manager",
      companyId: 10,
      permissions: ["accounting.read"],
    },
    domain: "accounting",
    action: "voucher.read",
    resourceType: "voucher",
    resourceId: 25,
    allowedRoles: ["Manager"],
    requiredPermissions: ["accounting.read"],
    ...overrides,
  };
}

describe("company isolation policy", () => {
  it("authorizes a resource using company ownership loaded from storage", async () => {
    const loadResourceCompany = vi.fn().mockResolvedValue(10);

    await expect(
      authorizeCompanyScopedResourceTx(request(), { loadResourceCompany })
    ).resolves.toEqual({ type: "voucher", id: 25, companyId: 10 });

    expect(loadResourceCompany).toHaveBeenCalledWith({
      tx: { id: "tx" },
      resourceType: "voucher",
      resourceId: 25,
    });
  });

  it("denies cross-company access even for an Admin", async () => {
    await expect(
      authorizeCompanyScopedResourceTx(
        request({ actor: { userId: 1, role: "Admin", companyId: 10 } }),
        { loadResourceCompany: vi.fn().mockResolvedValue(11) }
      )
    ).rejects.toMatchObject({
      name: "CompanyIsolationError",
      code: "CROSS_COMPANY_ACCESS_DENIED",
      message: "Forbidden",
    });
  });

  it("returns a non-leaking not-found result for missing resources", async () => {
    await expect(
      authorizeCompanyScopedResourceTx(request(), {
        loadResourceCompany: vi.fn().mockResolvedValue(null),
      })
    ).rejects.toMatchObject({
      name: "CompanyIsolationError",
      code: "RESOURCE_NOT_FOUND",
      message: "Not found",
    });
  });

  it("rejects invalid resource ids before storage access", async () => {
    const loadResourceCompany = vi.fn();

    await expect(
      authorizeCompanyScopedResourceTx(request({ resourceId: 0 }), {
        loadResourceCompany,
      })
    ).rejects.toMatchObject({ code: "RESOURCE_ID_INVALID" });

    expect(loadResourceCompany).not.toHaveBeenCalled();
  });

  it("rejects invalid company ownership returned by an adapter", async () => {
    await expect(
      authorizeCompanyScopedResourceTx(request(), {
        loadResourceCompany: vi.fn().mockResolvedValue(0),
      })
    ).rejects.toMatchObject({ code: "RESOURCE_COMPANY_INVALID" });
  });

  it("preserves role and permission enforcement after company validation", async () => {
    await expect(
      authorizeCompanyScopedResourceTx(
        request({
          actor: { userId: 1, role: "POS", companyId: 10, permissions: [] },
        }),
        { loadResourceCompany: vi.fn().mockResolvedValue(10) }
      )
    ).rejects.toMatchObject({ code: "ROLE_NOT_ALLOWED", message: "Forbidden" });
  });

  it("validates caller-supplied company filters against the session company", () => {
    expect(() =>
      assertRequestCompanyMatchesSession(
        { userId: 1, role: "Manager", companyId: 10 },
        10
      )
    ).not.toThrow();

    expect(() =>
      assertRequestCompanyMatchesSession(
        { userId: 1, role: "Admin", companyId: 10 },
        11
      )
    ).toThrowError(CompanyIsolationError);
  });
});
