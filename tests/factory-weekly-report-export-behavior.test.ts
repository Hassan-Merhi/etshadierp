import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const worksheets: FakeWorksheet[] = [];

  class FakeCell {
    value: unknown = null;
    font: unknown;
    fill: unknown;
    alignment: unknown;
    border: unknown;
    numFmt: unknown;
  }
  class FakeRow {
    height: unknown;
    cells = new Map<number, FakeCell>();
    getCell(index: number) {
      if (!this.cells.has(index)) this.cells.set(index, new FakeCell());
      return this.cells.get(index)!;
    }
  }
  class FakeWorksheet {
    rows = new Map<number, FakeRow>();
    columns = new Map<number, any>();
    merges: unknown[] = [];
    getRow(index: number) {
      if (!this.rows.has(index)) this.rows.set(index, new FakeRow());
      return this.rows.get(index)!;
    }
    getColumn(index: number) {
      if (!this.columns.has(index)) this.columns.set(index, {});
      return this.columns.get(index);
    }
    mergeCells(...args: unknown[]) {
      this.merges.push(args);
    }
    addRow(values: unknown[]) {
      const row = this.getRow(this.rows.size + 1);
      values.forEach((value, index) => {
        row.getCell(index + 1).value = value;
      });
      return row;
    }
  }
  class FakeWorkbook {
    xlsx = { writeBuffer: vi.fn(async () => Buffer.from("xlsx-report")) };
    addWorksheet() {
      const sheet = new FakeWorksheet();
      worksheets.push(sheet);
      return sheet;
    }
  }

  const makeBuilder = (result: unknown[]) => {
    const builder: any = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      leftJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };
  const db: any = { select: vi.fn(() => makeBuilder(selectResults.shift() ?? [])) };

  return { db, selectResults, worksheets, FakeWorkbook };
});

vi.mock("../server/db", () => ({ db: harness.db }));
vi.mock("../server/auth", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock("../server/lib/httpHandlers", () => ({ getErrorMessage: (error: any) => error?.message || String(error) }));
vi.mock("../server/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("exceljs", () => ({ default: harness.FakeWorkbook }));
vi.mock("pdfkit", () => ({ default: class FakePdf {} }));
vi.mock("fs", () => ({ default: { existsSync: () => false } }));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  isNull: (column: unknown) => ({ type: "isNull", column }),
  not: (condition: unknown) => ({ type: "not", condition }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
vi.mock("@shared/schema", () => ({
  factorySuppliers: { id: "suppliers.id", supplierCategoryId: "suppliers.categoryId", name: "suppliers.name" },
  factoryContainers: { id: "containers.id", supplierId: "containers.supplierId", status: "containers.status" },
  factoryRawStock: {
    companyId: "raw.companyId",
    containerId: "raw.containerId",
    receivedKg: "raw.receivedKg",
    usedKg: "raw.usedKg",
    offloadedAt: "raw.offloadedAt",
  },
  factoryMixBatches: {
    id: "mix.id",
    companyId: "mix.companyId",
    batchDate: "mix.batchDate",
    createdAt: "mix.createdAt",
  },
  factoryMixBatchSources: { mixBatchId: "src.mixBatchId", containerId: "src.containerId", weightKg: "src.weightKg" },
  factoryRawMaterialAdjustments: {
    companyId: "adj.companyId",
    supplierId: "adj.supplierId",
    date: "adj.date",
    type: "adj.type",
    kg: "adj.kg",
  },
  factorySupplierCategories: { id: "cats.id", name: "cats.name", companyId: "cats.companyId" },
}));

import { registerFactoryWeeklyReportExportRoutes } from "../server/routes/factory/bale-exports/weekly-report";

type Handler = (req: any, res: any) => unknown;

function handler() {
  let route: Handler | undefined;
  const app: any = { get: (_path: string, ...handlers: any[]) => (route = handlers.at(-1)) };
  registerFactoryWeeklyReportExportRoutes(app);
  return route!;
}

function responseHarness() {
  const headers = new Map<string, unknown>();
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers,
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
  };
  return res;
}

describe("factory weekly report export behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.selectResults.splice(0);
    harness.worksheets.splice(0);
  });

  it("keeps opening/closing balances consistent across stock-in, consumption, gaps, and manual adjustments", async () => {
    harness.selectResults.push(
      [
        {
          containerId: 1,
          supplierId: 2,
          categoryId: 7,
          receivedKg: "100",
          usedKg: "30",
          offloadedAt: new Date("2026-08-11T08:00:00.000Z"),
        },
      ],
      [{ id: 7, name: "Original" }],
      [
        { date: "2026-08-11", type: "ADD", kg: "10", catId: 7, supplierName: "Supplier A" },
        { date: "2026-08-12", type: "REMOVE", kg: "5", catId: 7, supplierName: "Supplier A" },
      ],
      [
        {
          containerId: 1,
          batchDate: "2026-08-12",
          batchCreatedAt: new Date("2026-08-12T08:00:00.000Z"),
          catIdViaContainer: 7,
          weightKg: "20",
        },
      ]
    );

    const res = responseHarness();
    await handler()({ session: { currentCompanyId: 4 }, query: { format: "excel", period: "all" } }, res);

    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.body).toEqual(Buffer.from("xlsx-report"));

    const sheet = harness.worksheets[0];
    const rowValues = [...sheet.rows.values()].map((row) => [...row.cells.values()].map((cell) => cell.value));
    const categoryRow = rowValues.find((values) => values[0] === "Original");
    const totalRow = rowValues.find((values) => values[0] === "TOTAL");

    expect(categoryRow).toBeDefined();
    expect(categoryRow?.[1]).toBe(0);
    expect(categoryRow?.[2]).toBe(110);
    expect(categoryRow?.at(-2)).toBe(35);
    expect(categoryRow?.at(-1)).toBe(75);
    expect(totalRow?.[1]).toBe(0);
    expect(totalRow?.[2]).toBe(110);
    expect(totalRow?.at(-2)).toBe(35);
    expect(totalRow?.at(-1)).toBe(75);
  });

  it("returns a clear company-selection error without executing report queries", async () => {
    const res = responseHarness();
    await handler()({ session: {}, query: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: "No company selected" });
    expect(harness.db.select).not.toHaveBeenCalled();
  });

  it("returns a no-data JSON response when a non-export format has no activity", async () => {
    harness.selectResults.push([], [], [], []);
    const res = responseHarness();
    await handler()({ session: { factoryCompanyId: 9 }, query: { format: "json", period: "month" } }, res);
    expect(res.body).toEqual({ message: "No data" });
  });
});
