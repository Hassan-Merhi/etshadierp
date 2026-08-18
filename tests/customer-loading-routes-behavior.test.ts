import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const executeResults: unknown[] = [];
  const selectResults: unknown[][] = [];
  const makeBuilder = (result: unknown[]) => {
    const builder: any = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(() => Promise.resolve(result)),
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
  };
});

vi.mock("../server/db", () => ({ db: harness.db }));
vi.mock("../server/auth", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock("../server/lib/httpHandlers", () => ({ getErrorMessage: (error: any) => error?.message || String(error) }));
vi.mock("../server/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../server/lib/queryResult", () => ({ resultRows: (value: any) => value?.rows ?? [] }));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
vi.mock("@shared/schema", () => ({
  customers: {
    id: "customers.id",
    legalName: "customers.legalName",
    companyId: "customers.companyId",
  },
}));

import { registerCustomerLoadingRoutes } from "../server/routes/factory/products/customerLoadingRoutes";

type Handler = (req: any, res: any) => unknown;

function buildRoutes() {
  const routes = new Map<string, Handler>();
  const app: any = {
    get: (path: string, ...handlers: any[]) => routes.set(`GET ${path}`, handlers.at(-1)),
  };
  registerCustomerLoadingRoutes(app);
  return routes;
}

function req(overrides: Record<string, unknown> = {}) {
  return {
    session: { factoryCompanyId: 4, currentCompanyId: 99 },
    query: { customerId: "12" },
    ...overrides,
  } as any;
}

function resHarness() {
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
  };
  return res;
}

describe("customer loading intelligence route", () => {
  const routes = buildRoutes();

  beforeEach(() => {
    vi.clearAllMocks();
    harness.executeResults.splice(0);
    harness.selectResults.splice(0);
  });

  it("requires a selected company and a positive customer id", async () => {
    const noCompany = resHarness();
    await routes.get("GET /api/factory/customer-loading/products")!(req({ session: {} }), noCompany);
    expect(noCompany.statusCode).toBe(400);
    expect(noCompany.body).toEqual({ message: "No company selected" });

    const invalidCustomer = resHarness();
    await routes.get("GET /api/factory/customer-loading/products")!(
      req({ query: { customerId: "abc" } }),
      invalidCustomer
    );
    expect(invalidCustomer.statusCode).toBe(400);
    expect(invalidCustomer.body).toEqual({ message: "Valid customerId is required" });
  });

  it("does not expose a customer outside the active company", async () => {
    harness.selectResults.push([]);
    const res = resHarness();
    await routes.get("GET /api/factory/customer-loading/products")!(req(), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ message: "Customer not found" });
    expect(harness.db.execute).not.toHaveBeenCalled();
  });

  it("classifies loaded and never-loaded products and returns customer KPIs", async () => {
    harness.selectResults.push([{ id: 12, legalName: "Customer A" }]);
    harness.executeResults.push({
      rows: [
        {
          id: 1,
          code: "P1",
          articleCode: "HMD11001",
          name: "Shirts",
          nameAr: null,
          categoryId: 3,
          categoryName: "Summer",
          categoryNameAr: null,
          weightPerBaleKg: "40.00",
          sellingPrice: "80.00",
          productionPrice: "50.00",
          active: true,
          totalBalesLoaded: 7,
          totalKgLoaded: "280.000",
          loadingCount: 2,
          lastLoadedAt: "2026-08-17T10:00:00.000Z",
        },
        {
          id: 2,
          code: "P2",
          articleCode: "HMD11002",
          name: "Shorts",
          nameAr: null,
          categoryId: 3,
          categoryName: "Summer",
          categoryNameAr: null,
          weightPerBaleKg: "25.00",
          sellingPrice: "60.00",
          productionPrice: "40.00",
          active: true,
          totalBalesLoaded: 0,
          totalKgLoaded: "0",
          loadingCount: 0,
          lastLoadedAt: null,
        },
      ],
    });

    const res = resHarness();
    await routes.get("GET /api/factory/customer-loading/products")!(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.customer).toEqual({ id: 12, legalName: "Customer A" });
    expect(res.body.summary).toEqual({
      totalProducts: 2,
      loadedProducts: 1,
      neverLoadedProducts: 1,
      productCoveragePct: 50,
      totalBalesLoaded: 7,
      totalKgLoaded: 280,
    });
    expect(res.body.products).toEqual([
      expect.objectContaining({ id: 1, loadingStatus: "LOADED", totalBalesLoaded: 7, totalKgLoaded: 280 }),
      expect.objectContaining({ id: 2, loadingStatus: "NEVER_LOADED", totalBalesLoaded: 0, totalKgLoaded: 0 }),
    ]);

    const sqlCall = harness.db.execute.mock.calls[0]?.[0] as any;
    expect(sqlCall.strings.join(" ")).toContain("fils.status <> 'CANCELLED'");
    expect(sqlCall.values).toContain(4);
    expect(sqlCall.values).toContain(12);
  });
});
