import { describe, expect, it } from "vitest";

import { ERP_ACCESS_BOUNDARY_STATE, resolveErpAccessBoundaryState } from "../../client/src/app/ErpAccessBoundary";

describe("ERP access boundary", () => {
  it("keeps the ERP shell closed until a user and company are available", () => {
    expect(
      resolveErpAccessBoundaryState({
        hasUser: false,
        companyId: null,
        hasAccessData: false,
        hasQueryError: false,
        synchronizedCompanyId: null,
      })
    ).toBe(ERP_ACCESS_BOUNDARY_STATE.loading);
  });

  it("fails closed when the page-access request fails", () => {
    expect(
      resolveErpAccessBoundaryState({
        hasUser: true,
        companyId: 12,
        hasAccessData: false,
        hasQueryError: true,
        synchronizedCompanyId: null,
      })
    ).toBe(ERP_ACCESS_BOUNDARY_STATE.error);
  });

  it("does not mount the router or sidebar with permissions from another company", () => {
    expect(
      resolveErpAccessBoundaryState({
        hasUser: true,
        companyId: 12,
        hasAccessData: true,
        hasQueryError: false,
        synchronizedCompanyId: 7,
      })
    ).toBe(ERP_ACCESS_BOUNDARY_STATE.loading);
  });

  it("opens the ERP shell only after the current company permissions are synchronized", () => {
    expect(
      resolveErpAccessBoundaryState({
        hasUser: true,
        companyId: 12,
        hasAccessData: true,
        hasQueryError: false,
        synchronizedCompanyId: 12,
      })
    ).toBe(ERP_ACCESS_BOUNDARY_STATE.ready);
  });
});
