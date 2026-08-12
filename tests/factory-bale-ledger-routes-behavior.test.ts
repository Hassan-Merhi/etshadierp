import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const executeResults: unknown[] = [];
  const selectResults: unknown[][] = [];
  const makeBuilder = (result: unknown[]) => {
    const builder: any = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };
  return {
    db: {
      execute: vi.fn(async () => executeResults.shift() ?? { rows: [] }),
      select: vi.fn(() => makeBuilder(selectResults.shift() ?? [])),
    },
    executeResults,
    selectResults,
    adjustInventory: vi.fn(),
    writeDaybookEntry: vi.fn(),
  };
});

vi.mock("../server/db", () => ({ db: harness.db }));
vi.mock("../server/auth", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock("../server/inventoryHelper", () => ({ adjustInventory: harness.adjustInventory }));
vi.mock("../server/routes/factory/_helpers", () => ({ writeDaybookEntry: harness.writeDaybookEntry }));
vi.mock("../server/lib/httpHandlers", () => ({ getErrorMessage: (error: any) => error?.message || String(error) }));
vi.mock("../server/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../server/lib/queryResult", () => ({ resultRows: (value: any) => value?.rows ?? [] }));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (column: unknown) => ({ type: "desc", column }),
  inArray: (column: unknown, values: unknown[]) => ({ type: "inArray", column, values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
vi.mock("@shared/schema", () => ({
  factoryCategories: { id: "cats.id", name: "cats.name", companyId: "cats.companyId" },
  factoryBaleProducts: {
    id: "products.id",
    name: "products.name",
    articleCode: "products.articleCode",
    categoryId: "products.categoryId",
    productionPrice: "products.productionPrice",
    companyId: "products.companyId",
  },
  factoryBales: { id: "bales.id" },
  stockItems: { id: "stockItems.id" },
  locations: { id: "locations.id" },
  factoryDaybookEntries: { id: "daybook.id" },
  factoryBaleWasteDispatches: { id: "waste.id" },
}));

import { registerEmployeeLedgerWasteRoutes } from "../server/routes/factory/employee-pos/employeeLedgerWasteRoutes";

type Handler = (req: any, res: any) => unknown;

function buildRoutes() {
  const routes = new Map<string, Handler>();
  const register = (method: string) => (path: string, ...handlers: any[]) => routes.set(`${method} ${path}`, handlers.at(-1));
  const app: any = { get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE") };
  registerEmployeeLedgerWasteRoutes(app);
  return routes;
}

function req(overrides: Record<string, unknown> = {}) {
  return { session: { currentCompanyId: 4 }, query: {}, params: {}, body: {}, ...overrides } as any;
}

function resHarness() {
  const headers = new Map<string, unknown>();
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
    set: vi.fn((name: string, value: unknown) => {
      headers.set(name, value);
      return res;
    }),
    headers,
  };
  return res;
}

describe("factory bale ledger route behavior", () => {
  const routes = buildRoutes();

  beforeEach(() => {
    vi.clearAllMocks();
    harness.executeResults.splice(0);
    harness.selectResults.splice(0);
  });

  it("classifies physical, waste, sold, dispatched, pending, and stale bales into mutually exclusive ledger buckets", async () => {
    harness.executeResults.push(
      {
        rows: [
          { id: 1, productId: 1, productName: "Shirts", articleCode: "SH-1", status: "IN_STOCK", referenceNumber: "R1", weightKg: 40 },
          { id: 2, productId: 2, productName: "Wipers", articleCode: "WP-1", status: "IN_STOCK", referenceNumber: "R2", weightKg: 20 },
          { id: 3, productId: 1, status: "SOLD", referenceNumber: "R3", weightKg: 40 },
          { id: 4, productId: 1, status: "SOLD", referenceNumber: "R4", weightKg: 40 },
          { id: 5, productId: 1, status: "FINALIZED", referenceNumber: "R5", weightKg: 40 },
          { id: 6, productId: 2, status: "DISPATCHED", wasteDispatchId: 77, referenceNumber: "R6", weightKg: 20 },
          { id: 7, productId: 1, status: "RESERVED_FOR_ORDER", referenceNumber: "R7", weightKg: 40 },
          { id: 8, productId: 1, status: "IN_STOCK", referenceNumber: "R8", weightKg: 40 },
          { id: 9, productId: 1, status: "IN_STOCK", referenceNumber: "R9", weightKg: 40 },
          { id: 10, productId: null, productName: "Waste", articleCode: "HMD16001", status: "IN_STOCK", referenceNumber: "R10", weightKg: 15 },
        ],
      },
      { rows: [{ baleId: 3 }, { baleId: 8 }] },
      { rows: [{ baleId: 9 }] },
    );
    harness.selectResults.push(
      [
        { id: 1, name: "Shirts", articleCode: "SH-1", categoryId: 10, productionPrice: "10" },
        { id: 2, name: "Wipers", articleCode: "WP-1", categoryId: 20, productionPrice: "5" },
      ],
      [
        { id: 10, name: "Clothing" },
        { id: 20, name: "Wiper Waste" },
      ],
    );

    const res = resHarness();
    await routes.get("GET /api/factory/bale-ledger")!(req(), res);

    expect(res.headers.get("Cache-Control")).toBe("private, max-age=120");
    expect(res.body.currentStock).toEqual([
      expect.objectContaining({ productName: "Shirts", baleCount: 1, totalWeightKg: 40, totalCost: 10 }),
    ]);
    expect(res.body.wasteStock).toEqual([
      expect.objectContaining({ productName: "Waste", baleCount: 1, totalWeightKg: 15 }),
      expect.objectContaining({ productName: "Wipers", baleCount: 1, totalWeightKg: 20, totalCost: 5 }),
    ]);
    expect(res.body.pendingLoading).toEqual([
      expect.objectContaining({ productName: "Shirts", baleCount: 3, totalWeightKg: 120, totalCost: 30 }),
    ]);
    expect(res.body.sold).toEqual([
      expect.objectContaining({ productName: "Shirts", baleCount: 3, totalWeightKg: 120, totalCost: 30 }),
    ]);
    expect(res.body.wasteDispatched).toEqual([
      expect.objectContaining({ productName: "Wipers", baleCount: 1, totalWeightKg: 20, totalCost: 5 }),
    ]);
    expect(res.body.totals.grand).toEqual({ baleCount: 10, totalWeightKg: 335, totalCost: 80 });
  });

  it("treats HMD16 article codes as waste even when there is no catalog product", async () => {
    harness.executeResults.push(
      { rows: [{ id: 1, productId: null, productName: "Loose Waste", articleCode: "HMD16099", status: "IN_STOCK", weightKg: 12 }] },
      { rows: [] },
      { rows: [] },
    );
    harness.selectResults.push([], []);
    const res = resHarness();
    await routes.get("GET /api/factory/bale-ledger")!(req(), res);
    expect(res.body.currentStock).toEqual([]);
    expect(res.body.wasteStock).toEqual([
      expect.objectContaining({ productName: "Loose Waste", articleCode: "HMD16099", baleCount: 1, totalWeightKg: 12 }),
    ]);
  });

  it("requires a selected company and validates lazy-detail section names", async () => {
    const noCompany = resHarness();
    await routes.get("GET /api/factory/bale-ledger")!(req({ session: {} }), noCompany);
    expect(noCompany.statusCode).toBe(400);
    expect(noCompany.body).toEqual({ message: "No company selected" });

    const invalidSection = resHarness();
    await routes.get("GET /api/factory/bale-ledger/details")!(req({ query: { section: "other", productId: "1" } }), invalidSection);
    expect(invalidSection.statusCode).toBe(400);
    expect(invalidSection.body).toEqual({ message: "Invalid section" });
  });
});
