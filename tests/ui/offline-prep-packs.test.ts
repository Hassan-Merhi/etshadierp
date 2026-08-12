import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  first: vi.fn(),
  packageFirst: vi.fn(),
  deleteRows: vi.fn(),
  bulkPut: vi.fn(),
  packageAdd: vi.fn(),
  packageUpdate: vi.fn(),
  metaAdd: vi.fn(),
  metaUpdate: vi.fn(),
  supplierRows: vi.fn(),
}));

vi.mock("../../client/src/lib/db", () => {
  const cachedTable = {
    where: () => ({
      equals: () => ({ delete: harness.deleteRows, toArray: harness.supplierRows }),
    }),
    bulkPut: harness.bulkPut,
  };
  return {
    db: {
      users: cachedTable,
      companies: cachedTable,
      companySettings: cachedTable,
      permissions: cachedTable,
      locations: cachedTable,
      ledgerAccounts: cachedTable,
      suppliers: cachedTable,
      customers: cachedTable,
      stockItems: cachedTable,
      inventoryByLocation: cachedTable,
      employees: cachedTable,
      factorySuppliers: cachedTable,
      factoryCategories: cachedTable,
      factoryBaleProducts: cachedTable,
      factoryContainers: cachedTable,
      factoryRawStock: cachedTable,
      offlinePackages: {
        where: () => ({ equals: () => ({ first: harness.packageFirst }) }),
        add: harness.packageAdd,
        update: harness.packageUpdate,
      },
      offlineMeta: {
        where: () => ({ equals: () => ({ first: harness.first }) }),
        add: harness.metaAdd,
        update: harness.metaUpdate,
      },
    },
  };
});

import {
  buildPacks,
  getLastOfflinePrepTime,
  getOfflineReadiness,
  isOfflinePrepInProgress,
  runOfflinePrep,
} from "../../client/src/lib/offlinePrep";

describe("offline preparation data packs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.first.mockResolvedValue(undefined);
    harness.packageFirst.mockResolvedValue(undefined);
    harness.deleteRows.mockResolvedValue(undefined);
    harness.bulkPut.mockResolvedValue(undefined);
    harness.packageAdd.mockResolvedValue(1);
    harness.packageUpdate.mockResolvedValue(1);
    harness.metaAdd.mockResolvedValue(1);
    harness.metaUpdate.mockResolvedValue(1);
    harness.supplierRows.mockResolvedValue([]);
  });

  it("normalizes every ERP, POS, factory, and shared dataset into company-owned cache entities", () => {
    const packs = buildPacks();
    const datasets = packs.flatMap((pack) => pack.datasets.map((dataset) => ({ pack: pack.id, dataset })));
    const extracted = new Map<string, ReturnType<(typeof datasets)[number]["dataset"]["extractItems"]>>();

    for (const { dataset } of datasets) {
      let payload: unknown = { items: [{ id: 7, stockItemId: 8, locationId: 9, name: dataset.label }] };
      if (dataset.id === "user") payload = { id: 7, name: "Current User" };
      if (dataset.id === "companies") payload = [{ id: 4, name: "Company Four" }];
      if (["companySettings", "permissions"].includes(dataset.id)) payload = { enabled: true };
      if (dataset.id === "inventory") payload = { data: [{ stockItemId: 8, locationId: 9, quantity: "12" }] };
      extracted.set(dataset.id, dataset.extractItems(payload, 4));
    }

    expect(packs.map((pack) => pack.id)).toEqual(["shared", "erp", "pos", "factory"]);
    expect(extracted.get("user")?.[0]).toMatchObject({ id: 7, companyId: 4 });
    expect(extracted.get("companies")?.[0]).toMatchObject({ id: 4, companyId: 4 });
    expect(extracted.get("inventory")?.[0]).toMatchObject({ id: "8_9", companyId: 4 });
    expect(extracted.get("posDrafts")?.[0].id).toBe("pos_draft_7");
    expect(extracted.get("baleProducts")?.[0].id).toBe("bp_7");
    expect(extracted.get("factorySuppliersWithBalances")?.[0].id).toBe("fsb_7");
    for (const entries of extracted.values()) {
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => JSON.parse(entry.data))).toBe(true);
    }
  });

  it("supports wrapper arrays, flat arrays, and single-object endpoints", () => {
    const locations = buildPacks()
      .flatMap((pack) => pack.datasets)
      .find((dataset) => dataset.id === "locations")!;

    expect(locations.extractItems([{ id: 1 }], 4)).toHaveLength(1);
    expect(locations.extractItems({ records: [{ id: 2 }, { id: 3 }] }, 4)).toHaveLength(2);
    expect(locations.extractItems({ id: 4 }, 4)).toHaveLength(1);
    expect(locations.extractItems(null, 4)).toEqual([]);
  });

  it("reports persisted ready and partial metadata without exposing malformed storage", async () => {
    harness.first.mockResolvedValueOnce({
      id: 1,
      key: "main",
      preparedAt: 12345,
      status: "partial",
      completedDatasets: 17,
      totalDatasets: 20,
      errors: JSON.stringify(["Factory daybook: HTTP 503"]),
      packSummary: JSON.stringify({ factory: { label: "Factory", count: 12, completedAt: 12345 } }),
    });

    await expect(getOfflineReadiness()).resolves.toEqual({
      ready: false,
      partial: true,
      preparedAt: 12345,
      completedDatasets: 17,
      totalDatasets: 20,
      errors: ["Factory daybook: HTTP 503"],
      packSummary: { factory: { label: "Factory", count: 12, completedAt: 12345 } },
    });

    harness.first.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    await expect(getOfflineReadiness()).resolves.toMatchObject({
      ready: false,
      partial: false,
      preparedAt: null,
      errors: [],
    });
    expect(getLastOfflinePrepTime(4)).toBeNull();
    expect(isOfflinePrepInProgress(4)).toBe(false);
  });

  it(
    "downloads, stores, verifies, and timestamps a complete offline preparation run",
    { timeout: 60_000 },
    async () => {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(JSON.stringify({ items: [{ id: 7, stockItemId: 8, locationId: 9, name: String(input) }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
      );
      vi.stubGlobal("fetch", fetchMock);
      const progress = vi.fn();

      const result = await runOfflinePrep(4, progress);

      expect(result.phase).toBe("done");
      expect(result.percent).toBe(100);
      expect(result.failedDatasets).toBe(0);
      expect(result.completedDatasets).toBe(result.totalDatasets);
      expect(fetchMock).toHaveBeenCalledWith("/api/stock-items/light", { credentials: "include" });
      expect(harness.bulkPut).toHaveBeenCalled();
      expect(harness.packageAdd).toHaveBeenCalled();
      expect(harness.metaAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "main",
          status: "ready",
          completedDatasets: result.completedDatasets,
        })
      );
      expect(getLastOfflinePrepTime(4)).not.toBeNull();
      expect(isOfflinePrepInProgress(4)).toBe(false);
      expect(progress).toHaveBeenLastCalledWith(result);
    }
  );
});
