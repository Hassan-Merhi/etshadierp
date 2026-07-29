import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Phase 6 chat reporting architecture", () => {
  it("keeps chatService behind the stable report gateway", () => {
    const source = read("server/chatService.ts");
    expect(source).toContain('from "./chat/reports"');
    expect(source).not.toContain("switch (params.queryType)");
  });

  it("keeps the public report module as a thin dispatcher facade", () => {
    const source = read("server/chat/reports.ts");
    expect(source).toContain("dispatchDataQuery");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(30);
  });

  it("registers focused report domains and a compatibility fallback", () => {
    const source = read("server/chat/reports/domains/reportDomainDispatcher.ts");
    expect(source).toContain("accountingReportDomain");
    expect(source).toContain("customerSupplierReportDomain");
    expect(source).toContain("inventoryReportDomain");
    expect(source).toContain("factoryReportDomain");
    expect(source).toContain("containerReportDomain");
    expect(source).toContain("salesReportDomain");
    expect(source).toContain("operationsReportDomain");
    expect(source).toContain("runLegacyDataQuery");
  });
});
