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

import { resolveParentCompanyId } from "../server/routes/helpers/supplierBalanceHelpers";
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
