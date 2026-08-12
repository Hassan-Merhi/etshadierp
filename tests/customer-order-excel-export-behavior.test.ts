import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const workbooks: FakeWorkbook[] = [];

  class FakeCell {
    value: unknown = null;
    font: unknown;
    fill: unknown;
    alignment: unknown;
    border: unknown;
  }
  class FakeRow {
    number: number;
    height: unknown;
    cells = new Map<number, FakeCell>();
    constructor(number: number, values: unknown[] = []) {
      this.number = number;
      values.forEach((value, index) => {
        this.getCell(index + 1).value = value;
      });
    }
    getCell(index: number) {
      if (!this.cells.has(index)) this.cells.set(index, new FakeCell());
      return this.cells.get(index)!;
    }
    eachCell(callback: (cell: FakeCell) => void) {
      this.cells.forEach(callback);
    }
  }
  class FakeWorksheet {
    columns: unknown;
    rows: FakeRow[] = [];
    merges: unknown[] = [];
    addRow(values: unknown[] = []) {
      const row = new FakeRow(this.rows.length + 1, values);
      this.rows.push(row);
      return row;
    }
    mergeCells(...args: unknown[]) {
      this.merges.push(args);
    }
  }
  class FakeWorkbook {
    worksheets: FakeWorksheet[] = [];
    xlsx = {
      writeBuffer: vi.fn(async () => Buffer.from("PKinvoice-workbook")),
      writeFile: vi.fn(async () => undefined),
    };
    constructor() {
      workbooks.push(this);
    }
    addWorksheet() {
      const sheet = new FakeWorksheet();
      this.worksheets.push(sheet);
      return sheet;
    }
  }

  const makeBuilder = (result: unknown[]) => {
    const builder: any = {
      from: vi.fn(() => builder),
      leftJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };
  const db: any = { select: vi.fn(() => makeBuilder(selectResults.shift() ?? [])) };

  return {
    db,
    selectResults,
    workbooks,
    FakeWorkbook,
    logAudit: vi.fn(),
    getExportPriceVisibility: vi.fn(),
  };
});

vi.mock("../server/db", () => ({ db: harness.db }));
vi.mock("../server/auth", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock("../server/routes/helpers/auditHelpers", () => ({ logAudit: harness.logAudit }));
vi.mock("../server/helpers/exportVisibility", () => ({ getExportPriceVisibility: harness.getExportPriceVisibility }));
vi.mock("../server/lib/httpHandlers", () => ({
  getErrorMessage: (error: any) => error?.message || String(error),
  getErrorStack: () => "stack",
}));
vi.mock("../server/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../server/lib/contentDisposition", () => ({
  contentDisposition: (name: string) => `attachment; filename=${name}`,
}));
vi.mock("../server/lib/parseId", () => ({
  parseId: (value: unknown) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  },
}));
vi.mock("../server/routes/factory/customer-orders/orderHelpers", () => ({
  buildExportFilename: (parts: unknown[], ext: string) => `${parts.filter(Boolean).join("_")}.${ext}`,
}));
vi.mock("exceljs", () => ({ default: harness.FakeWorkbook }));
vi.mock("os", () => ({ default: { tmpdir: () => "/tmp" } }));
vi.mock("crypto", () => ({ default: { randomUUID: () => "uuid" } }));
vi.mock("fs", () => ({
  default: {
    promises: {
      readFile: vi.fn(async () => Buffer.from("PKfallback")),
      unlink: vi.fn(async () => undefined),
    },
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  inArray: (column: unknown, values: unknown[]) => ({ type: "inArray", column, values }),
}));
vi.mock("@shared/schema", () => ({
  factoryBaleProducts: {
    id: "products.id",
    companyId: "products.companyId",
    articleCode: "products.articleCode",
    name: "products.name",
    weightPerBaleKg: "products.weightPerBaleKg",
  },
  factoryBales: { id: "bales.id" },
  customerOrders: {
    id: "orders.id",
    companyId: "orders.companyId",
    customerId: "orders.customerId",
    invoiceNumber: "orders.invoiceNumber",
    orderDate: "orders.orderDate",
    status: "orders.status",
    subtotalBales: "orders.subtotalBales",
    freightAmount: "orders.freightAmount",
    otherChargesTotal: "orders.otherChargesTotal",
    grandTotal: "orders.grandTotal",
    totalQtyBales: "orders.totalQtyBales",
    containerNumber: "orders.containerNumber",
    destination: "orders.destination",
  },
  customerOrderLines: { orderId: "lines.orderId" },
  customerOrderBales: { orderId: "balesLink.orderId" },
  customerOrderCharges: { orderId: "charges.orderId" },
  customers: { id: "customers.id", legalName: "customers.legalName", code: "customers.code" },
  companies: { id: "companies.id" },
}));

import { registerOrderExcelExportRoutes } from "../server/routes/factory/customer-orders/orderExcelExportRoutes";

type Handler = (req: any, res: any) => unknown;

function buildRoutes() {
  const routes = new Map<string, Handler>();
  const app: any = {
    get: (path: string, ...handlers: any[]) => routes.set(path, handlers.at(-1)),
  };
  registerOrderExcelExportRoutes(app);
  return routes;
}

function responseHarness() {
  const headers = new Map<string, unknown>();
  const res: any = {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
    setHeader: vi.fn((name: string, value: unknown) => headers.set(name, value)),
    end: vi.fn((body?: unknown) => {
      res.body = body;
      return res;
    }),
    headers,
  };
  return res;
}

describe("customer order Excel export behavior", () => {
  const routes = buildRoutes();

  beforeEach(() => {
    vi.clearAllMocks();
    harness.selectResults.splice(0);
    harness.workbooks.splice(0);
    harness.getExportPriceVisibility.mockResolvedValue({ hideSelling: false });
  });

  it("exports canonical product names, weights, prices, charges, and audit evidence", async () => {
    harness.selectResults.push(
      [{ id: 4, baseCurrency: "USD" }],
      [
        {
          id: 20,
          invoiceNumber: "INV-20",
          orderDate: "2026-08-12",
          status: "FINALIZED",
          subtotalBales: "75",
          freightAmount: "10",
          otherChargesTotal: "5",
          grandTotal: "90",
          totalQtyBales: 3,
          containerNumber: "CONT-1",
          destination: "Kolwezi",
          customerName: "Customer A",
          customerCode: "CUS-A",
        },
      ],
      [{ id: 1, orderId: 20, name: "Handling", amount: "5", chargeType: "OTHER" }],
      [
        {
          id: 1,
          orderId: 20,
          articleCode: "SH-1",
          baleName: "Legacy Shirts",
          qty: "2",
          weightPerBale: "40",
          totalWeight: "90",
          pricePerBale: "25",
          totalPrice: "50",
          pricingMode: "per_bale",
          pricePerKg: "0",
        },
        {
          id: 2,
          orderId: 20,
          articleCode: "PT-1",
          baleName: "Legacy Pants",
          qty: "1",
          weightPerBale: "50",
          totalWeight: "50",
          pricePerBale: "25",
          totalPrice: "25",
          pricingMode: "per_kg",
          pricePerKg: "0.5",
        },
      ],
      [
        { articleCode: "SH-1", name: "Shirts", weightPerBaleKg: "45" },
        { articleCode: "PT-1", name: "Pants", weightPerBaleKg: "50" },
      ]
    );

    const res = responseHarness();
    await routes.get("/api/factory/customer-orders/:id/export-excel")!(
      {
        session: { currentCompanyId: 4, userId: "admin-1", username: "admin" },
        params: { id: "20" },
        query: {},
      },
      res
    );

    expect(harness.getExportPriceVisibility).toHaveBeenCalled();
    expect(harness.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 4, action: "export", tableName: "factory_customer_orders", recordId: 20 })
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(String(res.headers.get("Content-Disposition"))).toContain("CONT-1_Customer A_Kolwezi.xlsx");
    expect(res.body).toEqual(Buffer.from("PKinvoice-workbook"));

    const sheet = harness.workbooks[0].worksheets[0];
    const text = sheet.rows.flatMap((row) => [...row.cells.values()].map((cell) => cell.value)).join(" | ");
    expect(text).toContain("Commercial Invoice");
    expect(text).toContain("INV-20");
    expect(text).toContain("Shirts");
    expect(text).toContain("Pants");
    expect(text).toContain("Handling");
    expect(text).toContain("Grand Total");
  });

  it("hides selling columns and financial charges when export visibility and noCharges require it", async () => {
    harness.getExportPriceVisibility.mockResolvedValue({ hideSelling: true });
    harness.selectResults.push(
      [{ id: 4, baseCurrency: "USD" }],
      [
        {
          id: 21,
          invoiceNumber: "INV-21",
          orderDate: "2026-08-12",
          status: "FINALIZED",
          subtotalBales: "25",
          freightAmount: "10",
          otherChargesTotal: "5",
          grandTotal: "40",
          totalQtyBales: 1,
          containerNumber: "CONT-2",
          destination: "Kinshasa",
          customerName: "Customer B",
          customerCode: "CUS-B",
        },
      ],
      [{ id: 1, orderId: 21, name: "Handling", amount: "5", chargeType: "OTHER" }],
      [
        {
          id: 1,
          orderId: 21,
          articleCode: "SH-1",
          baleName: "Shirts",
          qty: "1",
          weightPerBale: "45",
          totalWeight: "45",
          pricePerBale: "25",
          totalPrice: "25",
          pricingMode: "per_bale",
          pricePerKg: "0",
        },
      ],
      [{ articleCode: "SH-1", name: "Shirts", weightPerBaleKg: "45" }]
    );

    const res = responseHarness();
    await routes.get("/api/factory/customer-orders/:id/export-excel")!(
      { session: { factoryCompanyId: 4, userId: "admin-1" }, params: { id: "21" }, query: { noCharges: "1" } },
      res
    );

    const text = harness.workbooks[0].worksheets[0].rows
      .flatMap((row) => [...row.cells.values()].map((cell) => cell.value))
      .join(" | ");
    expect(text).not.toContain("Price/Bale");
    expect(text).not.toContain("Grand Total");
    expect(res.body).toEqual(Buffer.from("PKinvoice-workbook"));
  });

  it("rejects missing company, invalid ids, and cross-company orders before workbook generation", async () => {
    const noCompany = responseHarness();
    await routes.get("/api/factory/customer-orders/:id/export-excel")!(
      { session: {}, params: { id: "20" }, query: {} },
      noCompany
    );
    expect(noCompany.statusCode).toBe(400);

    const invalid = responseHarness();
    await routes.get("/api/factory/customer-orders/:id/export-excel")!(
      { session: { currentCompanyId: 4 }, params: { id: "bad" }, query: {} },
      invalid
    );
    expect(invalid.statusCode).toBe(400);

    harness.selectResults.push([{ id: 4, baseCurrency: "USD" }], []);
    const missing = responseHarness();
    await routes.get("/api/factory/customer-orders/:id/export-excel")!(
      { session: { currentCompanyId: 4 }, params: { id: "99" }, query: {} },
      missing
    );
    expect(missing.statusCode).toBe(404);
    expect(harness.workbooks).toHaveLength(0);
  });
});
