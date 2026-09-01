import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { poImportDatabaseScopeContinuityBoundary } from "../server/middleware/poImportDatabaseScopeContinuity";
import {
  createTenantDatabaseScope,
  getDatabaseScopeRuntimeContext,
  runWithDatabaseScopeRuntimeContext,
} from "../server/services/security/databaseScopeRuntimeContext";

function requestWithSession(userId: string | undefined, companyId: number | undefined): Request {
  return {
    session: {
      userId,
      currentCompanyId: companyId,
    },
  } as unknown as Request;
}

function responseStub(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  vi.mocked(res.json).mockReturnValue(res);
  return res;
}

describe("PO Import database scope continuity", () => {
  it("re-establishes the active company scope when the multipart hop lost it", () => {
    const req = requestWithSession("user-1", 12);
    const res = responseStub();
    let observedCompanyId: number | undefined;

    const next: NextFunction = () => {
      const scope = getDatabaseScopeRuntimeContext();
      observedCompanyId = scope?.kind === "tenant" ? scope.companyId : undefined;
    };

    poImportDatabaseScopeContinuityBoundary(req, res, next);

    expect(observedCompanyId).toBe(12);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("preserves an already-authorized tenant scope", () => {
    const req = requestWithSession("user-1", 12);
    const res = responseStub();
    let observedAuthorizedCompanyIds: readonly number[] | undefined;

    runWithDatabaseScopeRuntimeContext(createTenantDatabaseScope(12, [14], "authorized-companies"), () => {
      poImportDatabaseScopeContinuityBoundary(req, res, () => {
        const scope = getDatabaseScopeRuntimeContext();
        observedAuthorizedCompanyIds = scope?.kind === "tenant" ? scope.authorizedCompanyIds : undefined;
      });
    });

    expect(observedAuthorizedCompanyIds).toEqual([14]);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("fails closed when the active session company disagrees with the existing tenant scope", () => {
    const req = requestWithSession("user-1", 12);
    const res = responseStub();
    const next = vi.fn();

    runWithDatabaseScopeRuntimeContext(createTenantDatabaseScope(13), () => {
      poImportDatabaseScopeContinuityBoundary(req, res, next);
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      code: "PO_IMPORT_COMPANY_SCOPE_MISMATCH",
      message: "PO Import company scope does not match the active company.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("leaves authentication handling to requireAuth when there is no authenticated session", () => {
    const req = requestWithSession(undefined, undefined);
    const res = responseStub();
    const next = vi.fn();

    poImportDatabaseScopeContinuityBoundary(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
