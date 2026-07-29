import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compositionPath = path.resolve(process.cwd(), "server/routes/reportsRoutes.ts");

describe("report route composition", () => {
  it("registers focused report domains before the legacy compatibility registry", () => {
    const source = fs.readFileSync(compositionPath, "utf8");
    const legacyIndex = source.indexOf("registerLegacyReportsRoutes(app)");

    expect(legacyIndex).toBeGreaterThan(-1);
    expect(source.indexOf("registerReportsNetProfitStatementRoutes(app)")).toBeLessThan(legacyIndex);
    expect(source.indexOf("registerReportsClosingStockRoutes(app)")).toBeLessThan(legacyIndex);
    expect(source.indexOf("registerDashboardAccountRoutes(app)")).toBeLessThan(legacyIndex);
    expect(source.indexOf("registerReportsContainerTrackingRoutes(app)")).toBeLessThan(legacyIndex);
  });

  it("keeps the extracted dashboard container-tracking route in its focused module", () => {
    const focusedPath = path.resolve(process.cwd(), "server/routes/reportsContainerTrackingRoutes.ts");
    const focusedSource = fs.readFileSync(focusedPath, "utf8");

    expect(focusedSource).toContain('app.get("/api/dashboard/container-tracking"');
    expect(focusedSource).toContain("requireAuth");
  });
});
