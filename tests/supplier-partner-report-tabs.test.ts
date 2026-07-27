import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const reportsPath = path.resolve(process.cwd(), "client/src/pages/sp/SpReports.tsx");
const reportsSource = fs.readFileSync(reportsPath, "utf8");

describe("Supplier Partner report tab navigation", () => {
  it("uses validated URL-backed tab state", () => {
    expect(reportsSource).toContain('useHubQueryState<ReportTab>');
    expect(reportsSource).toContain('const REPORT_TABS = ["payable", "profit", "sales-form"] as const');
    expect(reportsSource).toContain('defaultValue: "payable"');
    expect(reportsSource).toContain("omitDefault: true");
    expect(reportsSource).toContain("<Tabs value={tab}");
    expect(reportsSource).toContain("onValueChange={(value) => setTab(value as ReportTab)}");
  });

  it("keeps the default report URL clean and exposes canonical deep links", () => {
    expect(reportsSource).toContain('<TabsTrigger value="payable"');
    expect(reportsSource).toContain('<TabsTrigger value="profit"');
    expect(reportsSource).toContain('<TabsTrigger value="sales-form"');
    expect(reportsSource).toContain('<TabsContent value="payable"');
    expect(reportsSource).toContain('<TabsContent value="profit"');
    expect(reportsSource).toContain('<TabsContent value="sales-form"');
  });

  it("preserves all report and export contracts", () => {
    expect(reportsSource).toContain('const payableUrl = "/api/sp/report/payable"');
    expect(reportsSource).toContain("/api/sp/report/profit");
    expect(reportsSource).toContain('const splitsUrl = "/api/sp/profit-splits"');
    expect(reportsSource).toContain('apiRequest("POST", "/api/sp/profit-splits"');
    expect(reportsSource).toContain("/api/sp/sales-form/export?");
    expect(reportsSource).toContain("/api/sp/sales-form/export-v2?");
    expect(reportsSource).toContain('["/api/accounts/all", selectedCompany?.id]');
  });
});
