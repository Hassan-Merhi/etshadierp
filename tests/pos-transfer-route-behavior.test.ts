import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const tables = {
    inventory: { name: "inventory", averageRate: "inventory.averageRate", quantity: "inventory.quantity" },
    stockTransferVouchers: { name: "stockTransferVouchers" },
    stockTransferItems: { name: "stockTransferItems" },
    vouchers: { name: "vouchers" },
    locations: { name: "locations", id: "locations.id" },
  };
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const valuesByTable = new Map<unknown, unknown[]>();
  const txInsertValues: Array<{ table: unknown; values: unknown }> = [];
  const sourceInventory = [{ averageRate: "12.50", quantity: "20" }];
  const insertedVoucher = {
    id: 101,
    voucherNumber: "ST-101",
    voucherDate: "2026-08-11",
  };
  const insertedTransfer = {
    id: 202,
    sourceLocationId: 11,
    destinationLocationId: 23,
  };
  const insertedItem = {
    id: 303,
    transferId: 202,
    stockItemId: 5,
    sourceLocationId: 11,
    quantity: "3",
    rate: "12.50",
    totalAmount: "37.50",
  };

  valuesByTable.set(tables.vouchers, [insertedVoucher]);
  valuesByTable.set(tables.stockTransferVouchers, [insertedTransfer]);
  valuesByTable.set(tables.stockTransferItems, [insertedItem]);

  const tx = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        txInsertValues.push({ table, values });
        return { returning: vi.fn(async () => valuesByTable.get(table) ?? []) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => sourceInventory) })),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  };

  return {
    tables,
    handlers,
    txInsertValues,
    tx,
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => [{ name: "Main Warehouse" }]) })),
    })),
    getLocationById: vi.fn(),
    adjustInventory: vi.fn(),
    getActiveCompanyPermissionContext: vi.fn(),
    sendTransferWhatsApp: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock("../server/db", () => ({
  db: { transaction: harness.transaction, select: harness.select },
}));
vi.mock("../server/storage", () => ({ storage: { getLocationById: harness.getLocationById } }));
vi.mock("../server/auth", () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../server/lib/dateUtils", () => ({ getClientDate: () => "2026-08-11" }));
vi.mock("../server/lib/logger", () => ({ logger: harness.logger }));
vi.mock("../server/inventoryHelper", () => ({ adjustInventory: harness.adjustInventory }));
vi.mock("../server/helpers/sendTransferWhatsApp", () => ({ sendTransferWhatsApp: harness.sendTransferWhatsApp }));
vi.mock("../server/services/security/activeCompanyPermissionContext", () => ({
  getActiveCompanyPermissionContext: harness.getActiveCompanyPermissionContext,
}));
vi.mock("@shared/schema", () => harness.tables);
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => conditions,
}));

import { registerStockTransferCreateRoutes } from "../server/routes/fiscal-transfers/create";

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("stock transfer route POS notification behavior", () => {
  beforeEach(() => {
    harness.handlers.clear();
    harness.txInsertValues.splice(0);
    vi.clearAllMocks();
    harness.getLocationById.mockResolvedValue({ id: 23, name: "Riverside Shop" });
    harness.adjustInventory.mockResolvedValue(undefined);
    harness.getActiveCompanyPermissionContext.mockResolvedValue({
      role: "POS",
      assignedLocationId: 17,
      companyId: 4,
    });
    harness.sendTransferWhatsApp.mockResolvedValue(undefined);

    registerStockTransferCreateRoutes({
      post: (path: string, ...callbacks: Array<(...args: any[]) => unknown>) => {
        harness.handlers.set(path, callbacks.at(-1)!);
      },
    } as any);
  });

  it("resolves the POS assignment and sends to it without changing the inventory destination", async () => {
    const req = {
      body: {
        sourceLocationId: 11,
        destinationLocationId: 23,
        items: [{ stockItemId: 5, quantity: "3" }],
      },
      session: { userId: 7, currentCompanyId: 4 },
      user: { role: "POS" },
    };
    const res = {
      status: vi.fn(),
      json: vi.fn(),
    };
    res.status.mockReturnValue(res);

    await harness.handlers.get("/api/stock-transfers")!(req, res);
    await flushImmediate();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(harness.adjustInventory).toHaveBeenNthCalledWith(1, harness.tx, 11, 5, -3, 4);
    expect(harness.adjustInventory).toHaveBeenNthCalledWith(2, harness.tx, 23, 5, 3, 4, 12.5);
    expect(harness.getActiveCompanyPermissionContext).toHaveBeenCalledWith(req);
    expect(harness.sendTransferWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationLocationId: 23,
        recipientLocationId: 17,
        sourceLocationName: "Main Warehouse",
        destLocationName: "Riverside Shop",
        items: [{ stockItemId: 5, quantity: 3 }],
      })
    );
  });

  it("skips the POS notification when the authenticated assignment is absent", async () => {
    harness.getActiveCompanyPermissionContext.mockResolvedValue({
      role: "POS",
      assignedLocationId: null,
      companyId: 4,
    });
    const req = {
      body: {
        sourceLocationId: 11,
        destinationLocationId: 23,
        items: [{ stockItemId: 5, quantity: "3" }],
      },
      session: { userId: 7, currentCompanyId: 4 },
      user: { role: "POS" },
    };
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);

    await harness.handlers.get("/api/stock-transfers")!(req, res);
    await flushImmediate();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(harness.sendTransferWhatsApp).not.toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      "[TransferWA] POS user has no active assigned location; skipping notification",
      { userId: 7, companyId: 4 }
    );
  });
});
