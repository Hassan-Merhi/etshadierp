import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/storage", () => ({
  storage: {
    getCompanyById: vi.fn(),
    getAllCompanies: vi.fn(),
    getParentCompanyId: vi.fn(),
  },
}));

vi.mock("../server/security/companyAccessBoundary", () => ({
  getAccessibleCompanyIds: vi.fn(),
}));

vi.mock("../server/routes/performance/supplierVoucherEntryBatcher", () => ({
  getVoucherEntriesBySupplierBatched: vi.fn(),
}));

import { storage } from "../server/storage";
import { isParentCompanyContext, resolveParentCompanyId } from "../server/routes/helpers/supplierBalanceHelpers";

const getCompanyById = vi.mocked(storage.getCompanyById);
const getAllCompanies = vi.mocked(storage.getAllCompanies);
const getParentCompanyId = vi.mocked(storage.getParentCompanyId);

describe("explicit company parent resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllCompanies.mockResolvedValue([] as never);
    getParentCompanyId.mockResolvedValue(1);
  });

  it("keeps an unlinked ERP company standalone even when a legacy global parent exists", async () => {
    getCompanyById.mockResolvedValue({ id: 22, parentCompanyId: null } as never);

    await expect(resolveParentCompanyId(22)).resolves.toBe(22);
    expect(getParentCompanyId).not.toHaveBeenCalled();
  });

  it("uses the company's explicit parent link when one is configured", async () => {
    getCompanyById.mockResolvedValue({ id: 22, parentCompanyId: 7 } as never);

    await expect(resolveParentCompanyId(22)).resolves.toBe(7);
    expect(getParentCompanyId).not.toHaveBeenCalled();
  });

  it("retains the legacy global setting only for calls without a company context", async () => {
    getParentCompanyId.mockResolvedValue(9);

    await expect(resolveParentCompanyId()).resolves.toBe(9);
  });

  it("does not assign legacy opening-balance ownership to an unrelated standalone company", async () => {
    getCompanyById.mockResolvedValue({ id: 22, parentCompanyId: null } as never);
    getAllCompanies.mockResolvedValue([
      { id: 1, parentCompanyId: null },
      { id: 22, parentCompanyId: null },
    ] as never);
    getParentCompanyId.mockResolvedValue(1);

    await expect(isParentCompanyContext(22)).resolves.toBe(false);
  });
});
