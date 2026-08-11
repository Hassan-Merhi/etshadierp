import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  selectResults: [] as unknown[][],
  returningResults: [] as unknown[][],
  updates: [] as Array<{ table: unknown; values: unknown }>,
  inserts: [] as Array<{ table: unknown; values: unknown }>,
  deletes: [] as unknown[],
  adjustInventory: vi.fn(),
  sendRevisedTransferWhatsApp: vi.fn(),
  loggerError: vi.fn(),
}));

const tables = {
  inventory: { name: "inventory", locationId: "inventory.locationId", stockItemId: "inventory.stockItemId", averageRate: "inventory.averageRate" },
  stockTransferVouchers: { name: "stockTransferVouchers", id: "stockTransferVouchers.id", destinationLocationId: "stockTransferVouchers.destinationLocationId", voucherId: "stockTransferVouchers.voucherId" },
  stockTransferItems: { name: "stockTransferItems", id: "stockTransferItems.id", transferId: "stockTransferItems.transferId", quantity: "stockTransferItems.quantity", rate: "stockTransferItems.rate" },
  stockTransferRevisions: { name: "stockTransferRevisions", id: "stockTransferRevisions.id", transferId: "stockTransferRevisions.transferId", optional: "stockTransferRevisions.optional", createdBy: "stockTransferRevisions.createdBy", revisionNumber: "stockTransferRevisions.revisionNumber" },
  stockTransferRevisionItems: { name: "stockTransferRevisionItems", id: "stockTransferRevisionItems.id", revisionId: "stockTransferRevisionItems.revisionId" },
  vouchers: { name: "vouchers", id: "vouchers.id", companyId: "vouchers.companyId", voucherNumber: "vouchers.voucherNumber", voucherDate: "vouchers.voucherDate" },
  locations: { name: "locations", id: "locations.id" },
};

function makeDb() {
  const select = vi.fn(() => {
    const result = harness.selectResults.shift() ?? [];
    const builder: any = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  });
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      harness.inserts.push({ table, values });
      const returned = harness.returningResults.shift() ?? [];
      const result: any = {
        returning: vi.fn(async () => returned),
        then: (resolve: (value: undefined) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(undefined).then(resolve, reject),
      };
      return result;
    }),
  }));
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(async () => {
        harness.updates.push({ table, values });
      }),
    })),
  }));
  const remove = vi.fn((table: unknown) => ({
    where: vi.fn(async () => {
      harness.deletes.push(table);
    }),
  }));
  const db: any = { select, insert, update, delete: remove };
  db.transaction = vi.fn(async (callback: (tx: any) => unknown) => callback(db));
  return db;
}

const db = makeDb();

vi.mock("../server/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireNonPOS: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/db", () => ({ db }));
vi.mock("@shared/schema", () => tables);
vi.mock("../server/inventoryHelper", () => ({ adjustInventory: harness.adjustInventory }));
vi.mock("../server/helpers/sendRevisedTransferWhatsApp", () => ({ sendRevisedTransferWhatsApp: harness.sendRevisedTransferWhatsApp }));
vi.mock("../server/lib/logger", () => ({ logger: { error: harness.loggerError } }));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (column: unknown) => ({ type: "desc", column }),
  asc: (column: unknown) => ({ type: "asc", column }),
  inArray: (column: unknown, values: unknown[]) => ({ type: "inArray", column, values }),
}));

import { registerStockTransferRevisionWriteRoutes } from "../server/routes/fiscal-transfers/revisions-write";

describe("stock transfer revision write routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.handlers.clear();
    harness.selectResults.splice(0);
    harness.returningResults.splice(0);
    harness.updates.splice(0);
    harness.inserts.splice(0);
    harness.deletes.splice(0);
    registerStockTransferRevisionWriteRoutes({
      post: (path: string, ...callbacks: Array<(...args: any[]) => unknown>) => harness.handlers.set(`POST ${path}`, callbacks.at(-1)!),
      patch: (path: string, ...callbacks: Array<(...args: any[]) => unknown>) => harness.handlers.set(`PATCH ${path}`, callbacks.at(-1)!),
      delete: (path: string, ...callbacks: Array<(...args: any[]) => unknown>) => harness.handlers.set(`DELETE ${path}`, callbacks.at(-1)!),
    } as never);
  });

  it("creates a numbered revision and persists its changed items", async () => {
    harness.selectResults.push([{ revisionNumber: 2 }], [{ id: 401, revisionId: 41, stockItemId: 7 }]);
    harness.returningResults.push([{ id: 41, transferId: 9, revisionNumber: 3, optional: false }]);
    const req = {
      params: { transferId: "9" },
      body: {
        note: "  recount  ",
        items: [{ stockItemId: 7, stockItemName: "Item 7", sourceLocationId: 2, sourceLocationName: "L2", originalQuantity: 5, delta: 2, newQuantity: 7 }],
      },
      user: { id: "user-1" },
    };
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);

    await harness.handlers.get("POST /api/stock-transfers/:transferId/revisions")!(req, res);

    expect(harness.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: tables.stockTransferRevisions, values: expect.objectContaining({ transferId: 9, revisionNumber: 3, note: "recount", optional: false, createdBy: "user-1" }) }),
      expect.objectContaining({ table: tables.stockTransferRevisionItems, values: [expect.objectContaining({ revisionId: 41, stockItemId: 7, originalQuantity: "5", delta: "2", newQuantity: "7" })] }),
    ]));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 41, revisionNumber: 3, items: [expect.objectContaining({ id: 401 })] }));
  });

  it("approves all optional revisions as one net change using the transfer company for both inventory sides", async () => {
    harness.selectResults.push(
      [{ id: 41, transferId: 9 }],
      [{ id: 9, voucherId: 90, destinationLocationId: 8, inventoryApplied: true }],
      [{ id: 41, revisionNumber: 1 }, { id: 42, revisionNumber: 2 }],
      [
        { revisionId: 41, stockItemId: 7, sourceLocationId: 2, originalQuantity: "5", newQuantity: "6" },
        { revisionId: 42, stockItemId: 7, sourceLocationId: 2, originalQuantity: "5", newQuantity: "8" },
      ],
      [{ companyId: 4 }],
      [{ id: 300, stockItemId: 7, sourceLocationId: 2, quantity: "5", rate: "10" }],
      [{ qty: "8", rate: "10" }]
    );
    const req = { params: { id: "41" }, session: { currentCompanyId: 999 } };
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);

    await harness.handlers.get("POST /api/stock-transfer-revisions/:id/approve")!(req, res);

    expect(harness.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: tables.stockTransferItems, values: { quantity: "8", totalAmount: "80.00" } }),
      expect.objectContaining({ table: tables.vouchers, values: { totalAmount: "80.00" } }),
      expect.objectContaining({ table: tables.stockTransferRevisions, values: { optional: false } }),
    ]));
    expect(harness.adjustInventory).toHaveBeenNthCalledWith(1, db, 2, 7, -3, 4);
    expect(harness.adjustInventory).toHaveBeenNthCalledWith(2, db, 8, 7, 3, 4, 10);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("adds a newly revised item at source average cost and applies inventory exactly once", async () => {
    harness.selectResults.push(
      [{ id: 51, transferId: 12 }],
      [{ id: 12, voucherId: 120, destinationLocationId: 18, inventoryApplied: true }],
      [{ id: 51, revisionNumber: 1 }],
      [{ revisionId: 51, stockItemId: 17, sourceLocationId: 22, originalQuantity: "0", newQuantity: "4" }],
      [{ companyId: 6 }],
      [],
      [{ averageRate: "12.50" }],
      [{ qty: "4", rate: "12.50" }]
    );
    const req = { params: { id: "51" }, session: { currentCompanyId: 6 } };
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);

    await harness.handlers.get("POST /api/stock-transfer-revisions/:id/approve")!(req, res);

    expect(harness.inserts).toContainEqual({
      table: tables.stockTransferItems,
      values: expect.objectContaining({ transferId: 12, stockItemId: 17, sourceLocationId: 22, quantity: "4", rate: "12.50", totalAmount: "50.00" }),
    });
    expect(harness.adjustInventory).toHaveBeenNthCalledWith(1, db, 22, 17, -4, 6);
    expect(harness.adjustInventory).toHaveBeenNthCalledWith(2, db, 18, 17, 4, 6, 12.5);
    expect(harness.updates).toContainEqual({ table: tables.vouchers, values: { totalAmount: "50.00" } });
  });

  it("patches the optional flag and deletes revision items before the revision", async () => {
    const patchRes = { status: vi.fn(), json: vi.fn() };
    patchRes.status.mockReturnValue(patchRes);
    await harness.handlers.get("PATCH /api/stock-transfer-revisions/:id/optional")!({ params: { id: "41" }, body: { optional: 0 } }, patchRes);
    expect(harness.updates).toContainEqual({ table: tables.stockTransferRevisions, values: { optional: false } });
    expect(patchRes.json).toHaveBeenCalledWith({ success: true });

    const deleteRes = { status: vi.fn(), json: vi.fn() };
    deleteRes.status.mockReturnValue(deleteRes);
    await harness.handlers.get("DELETE /api/stock-transfer-revisions/:id")!({ params: { id: "41" } }, deleteRes);
    expect(harness.deletes).toEqual([tables.stockTransferRevisionItems, tables.stockTransferRevisions]);
    expect(deleteRes.json).toHaveBeenCalledWith({ success: true });
  });

  it("rejects invalid identifiers and empty revisions without DB writes", async () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await harness.handlers.get("POST /api/stock-transfers/:transferId/revisions")!({ params: { transferId: "0" }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    const res2 = { status: vi.fn(), json: vi.fn() };
    res2.status.mockReturnValue(res2);
    await harness.handlers.get("POST /api/stock-transfers/:transferId/revisions")!({ params: { transferId: "9" }, body: { items: [] } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(harness.inserts).toHaveLength(0);
  });
});
