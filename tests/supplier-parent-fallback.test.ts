import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/routes/_helpers", () => ({
  logAudit: vi.fn(),
}));

vi.mock("../server/routes/helpers/supplierBalanceHelpers", () => ({
  getSupplierBalanceForContext: vi.fn(),
  resolveParentCompanyId: vi.fn(),
}));

vi.mock("../server/routes/suppliers/supplierRepository", () => ({
  supplierRepository: {
    list: vi.fn(),
    listAll: vi.fn(),
    getById: vi.fn(),
    getByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getContainerCount: vi.fn(),
    getPurchaseOrders: vi.fn(),
    stockGroupExists: vi.fn(),
    updateStockGroup: vi.fn(),
  },
}));

import { getSupplierBalanceForContext, resolveParentCompanyId } from "../server/routes/helpers/supplierBalanceHelpers";
import { supplierRepository } from "../server/routes/suppliers/supplierRepository";
import { supplierService } from "../server/routes/suppliers/supplierService";

type SupplierRow = Awaited<ReturnType<typeof supplierRepository.list>>[number];

const activeCompanyId = 17;
const parentCompanyId = 1;
const parentSupplier = {
  id: 28,
  companyId: parentCompanyId,
  code: "HMD-BEY",
  legalName: "HMD BEIRUT",
} as unknown as SupplierRow;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("supplier parent fallback scope", () => {
  it("shows the parent supplier master in stats when a child has no local suppliers", async () => {
    const statsSupplier = {
      ...parentSupplier,
      active: true,
      openingBalance: "500",
    };
    vi.mocked(resolveParentCompanyId).mockResolvedValue(parentCompanyId);
    vi.mocked(supplierRepository.listAll).mockImplementation((companyId: number) =>
      Promise.resolve(companyId === parentCompanyId ? [statsSupplier] : [])
    );
    vi.mocked(supplierRepository.getContainerCount).mockResolvedValue(0);
    vi.mocked(supplierRepository.getPurchaseOrders).mockResolvedValue([]);
    vi.mocked(getSupplierBalanceForContext).mockResolvedValue({
      balance: 0,
      openingBalance: 0,
      hasActivity: false,
      entries: [],
      balancesByCurrency: {},
      historicalBaseBalance: 0,
    });

    const result = await supplierService.stats(activeCompanyId);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(statsSupplier.id);
    expect(supplierRepository.listAll).toHaveBeenNthCalledWith(1, activeCompanyId);
    expect(supplierRepository.listAll).toHaveBeenNthCalledWith(2, parentCompanyId);
    expect(getSupplierBalanceForContext).toHaveBeenCalledWith(statsSupplier, activeCompanyId);
  });

  it("keeps the normal supplier list empty when the active company has no suppliers", async () => {
    vi.mocked(supplierRepository.list).mockResolvedValue([]);

    const result = await supplierService.list(activeCompanyId, "");

    expect(result).toEqual([]);
    expect(supplierRepository.list).toHaveBeenCalledWith(activeCompanyId, "");
    expect(resolveParentCompanyId).not.toHaveBeenCalled();
  });

  it("allows the parent supplier master only when the caller explicitly opts in", async () => {
    vi.mocked(resolveParentCompanyId).mockResolvedValue(parentCompanyId);
    vi.mocked(supplierRepository.list).mockImplementation((companyId: number) =>
      Promise.resolve(companyId === parentCompanyId ? [parentSupplier] : [])
    );

    const result = await supplierService.list(activeCompanyId, "", true);

    expect(result).toEqual([parentSupplier]);
    expect(supplierRepository.list).toHaveBeenNthCalledWith(1, activeCompanyId, "");
    expect(supplierRepository.list).toHaveBeenNthCalledWith(2, parentCompanyId, "");
  });

  it("does not fall back on a failed search when the active company has its own suppliers", async () => {
    vi.mocked(resolveParentCompanyId).mockResolvedValue(parentCompanyId);
    vi.mocked(supplierRepository.list).mockResolvedValue([]);
    vi.mocked(supplierRepository.listAll).mockResolvedValue([
      { id: 91, companyId: activeCompanyId, legalName: "Local Supplier" } as unknown as SupplierRow,
    ]);

    const result = await supplierService.list(activeCompanyId, "HMD", true);

    expect(result).toEqual([]);
    expect(supplierRepository.listAll).toHaveBeenCalledWith(activeCompanyId);
    expect(resolveParentCompanyId).not.toHaveBeenCalled();
  });
});
