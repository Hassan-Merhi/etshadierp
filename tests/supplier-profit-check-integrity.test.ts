import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: { query: harness.query },
}));

import { registerSupplierProfitAnalyzeRoutes } from "../server/routes/supplier-profit-check/analyze";
import { consolidateProfitSourceItems } from "../server/routes/supplier-profit-check/analysis-core";

type Handler = (req: any, res: any) => unknown;

function routeHarness(): Handler {
  let handler: Handler | undefined;
  const app: any = {
    post: (_path: string, ...handlers: Handler[]) => {
      handler = handlers.at(-1);
    },
  };
  registerSupplierProfitAnalyzeRoutes(app, ((_req: any, _res: any, next: any) => next()) as any);
  if (!handler) throw new Error("analyze route was not registered");
  return handler;
}

function responseHarness() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

function result(rows: unknown[]) {
  return Promise.resolve({ rows });
}

describe("Supplier Profit Check integrity", () => {
  const analyze = routeHarness();

  beforeEach(() => {
    harness.query.mockReset();
  });

  it("keeps one canonical source row per stock item and sums duplicate quantities", () => {
    const rows = consolidateProfitSourceItems([
      {
        id: 7,
        code: "MJS4110",
        name: "Shirt",
        stock_group_id: 2,
        stock_group_name: "Supplier",
        proforma_qty: "6",
        proforma_price: "100",
        proforma_barcode: "MJS4110",
      },
      {
        id: 7,
        code: "MJS4110",
        name: "Shirt",
        stock_group_id: 2,
        stock_group_name: "Supplier",
        proforma_qty: "6",
        proforma_price: "100",
        proforma_barcode: "ALIAS-MJS4110",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].proforma_qty).toBe(12);
  });

  it("aggregates proforma lines after one-line-to-one-item resolution", async () => {
    harness.query.mockReturnValueOnce(result([{ id: 2 }])).mockReturnValueOnce(result([]));
    const res = responseHarness();

    await analyze(
      {
        session: { currentCompanyId: 4 },
        body: { supplierId: 2, sourceType: "proforma", proformaId: 31 },
      } as any,
      res
    );

    const sourceSql = String(harness.query.mock.calls[1]?.[0]);
    expect(sourceSql).toContain("JOIN LATERAL");
    expect(sourceSql).toContain("SUM(resolved.qty)");
    expect(sourceSql).toContain("GROUP BY");
    expect(res.body).toEqual([]);
  });

  it("rejects foreign or non-OTW container ids before reading loaded items", async () => {
    harness.query.mockReturnValueOnce(result([{ id: 2 }])).mockReturnValueOnce(result([{ id: 10 }]));
    const res = responseHarness();

    await analyze(
      {
        session: { currentCompanyId: 4 },
        body: { supplierId: 2, sourceType: "otw_containers", containerIds: [10, 11] },
      } as any,
      res
    );

    expect(res.statusCode).toBe(400);
    expect(harness.query).toHaveBeenCalledTimes(2);
    expect(String(harness.query.mock.calls[1]?.[0])).toContain("company_id = $2");
    expect(String(harness.query.mock.calls[1]?.[0])).toContain("supplier_id = $3");
    expect(String(harness.query.mock.calls[1]?.[0])).toContain("status = 'OTW'");
  });

  it("keeps proforma replacement atomic and override routes company scoped", () => {
    const root = process.cwd();
    const proforma = fs.readFileSync(path.join(root, "server/routes/supplier-profit-check/proforma.ts"), "utf8");
    const overrides = fs.readFileSync(path.join(root, "server/routes/supplier-profit-check/po-overrides.ts"), "utf8");
    const exportSource = fs.readFileSync(path.join(root, "server/routes/supplier-profit-check/export.ts"), "utf8");

    expect(proforma).toContain('client.query("BEGIN")');
    expect(proforma).toContain('client.query("COMMIT")');
    expect(proforma).toContain('client.query("ROLLBACK")');
    expect(proforma).toContain("resolveAndConsolidateItems");
    expect(overrides).toContain("si.company_id = $2");
    expect(overrides).toContain("po-overrides/bulk");
    expect(overrides).toContain("hasPoPrice");
    expect(overrides).toContain("hasAvgPrice");
    expect(exportSource).toContain("effectiveSellPrice");
    expect(exportSource).toContain("effectivePoPrice");
    expect(exportSource).toContain("landingCost");
  });
});
