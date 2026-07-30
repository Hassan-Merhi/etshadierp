import { readFileSync } from "node:fs";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Phase 10 API performance and bandwidth boundaries", () => {
  it("serves compact selected-location inventory and a server-built matrix", () => {
    const routes = source("server/routes/location/commonInventoryPerformanceRoutes.ts");
    expect(routes).toContain('req.query.profile !== "compact"');
    expect(routes).toContain('req.query.profile !== "matrix"');
    expect(routes).toContain("jsonb_object_agg(location_name, quantity ORDER BY location_name)");
    expect(routes).toContain('res.setHeader("X-Result-Profile", "compact")');
    expect(routes).toContain('res.setHeader("X-Result-Profile", "matrix")');
    expect(routes).not.toContain("Math.min(5000");
    expect(routes).toContain("Math.min(250");
  });

  it("removes the browser inventory page fan-out", () => {
    const hook = source("client/src/pages/location-inventory/useLocationInventoryQueries.ts");
    expect(hook).toContain("profile=compact");
    expect(hook).toContain("/api/inventory?profile=matrix");
    expect(hook).not.toContain("PAGE_SIZE = 5000");
    expect(hook).not.toContain("totalPages - 1");
    expect(hook).not.toContain("remaining.flat()");

    const rows = source("client/src/pages/location-inventory/useCombinedStockRows.ts");
    expect(rows).toContain("qtyByLocationName");
    expect(rows).toContain("Array.isArray(item.locations)");
    expect(rows).toContain("if (matrixProfile)");
  });

  it("streams location inventory exports instead of building an XLSX buffer", () => {
    const routes = source("server/routes/location/commonInventoryPerformanceRoutes.ts");
    expect(routes).toContain("ExcelJS.stream.xlsx.WorkbookWriter");
    expect(routes).toContain("stream: res");
    expect(routes).not.toContain('XLSX.write(workbook, {');
  });

  it("provides bounded proforma summaries, lazy lines, and selector payloads", () => {
    const routes = source("server/routes/performance/phase10FactoryBandwidthRoutes.ts");
    expect(routes).toContain('req.query.profile !== "summary"');
    expect(routes).toContain('"/api/factory/customer-proformas/:id/lines"');
    expect(routes).toContain('req.query.profile !== "selector"');
    expect(routes).toContain('res.setHeader("X-Result-Profile", "selector")');
    expect(routes).toContain("lineCount:");
    expect(routes).toContain("totalQuantity:");
    expect(routes).not.toContain("ORDER BY COALESCE(p.is_active");
  });

  it("registers focused handlers before broad legacy factory and location handlers", () => {
    const factoryRoutes = source("server/routes/factoryRoutes.ts");
    expect(factoryRoutes.indexOf("registerPhase10FactoryBandwidthRoutes(app)")).toBeGreaterThan(-1);
    expect(factoryRoutes.indexOf("registerPhase10FactoryBandwidthRoutes(app)")).toBeLessThan(
      factoryRoutes.indexOf("registerFactoryCustomersRoutes(app)"),
    );

    const locationRoutes = source("server/routes/location/index.ts");
    expect(locationRoutes.indexOf("registerCommonInventoryPerformanceRoutes(app)")).toBeLessThan(
      locationRoutes.indexOf("registerLocationInventoryRoutes(app)"),
    );
  });

  it("ships supporting indexes for every new query shape", () => {
    const migration = source("migrations/20260730_001_phase10_bandwidth_indexes.sql");
    for (const indexName of [
      "inventory_company_stock_location_idx",
      "customer_proformas_company_customer_name_idx",
      "customer_proforma_lines_proforma_article_idx",
      "factory_workers_company_active_name_idx",
      "factory_bale_products_company_active_name_idx",
    ]) {
      expect(migration).toContain(indexName);
    }
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
  });
});
