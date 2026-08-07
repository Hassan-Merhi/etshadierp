import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Bandwidth Phase 4 heavy-page contracts", () => {
  it("pauses Pending Loadings polling in hidden tabs and slows it to one minute", () => {
    const source = read("client/src/pages/PendingLoadings.tsx");
    expect(source).toContain("visibleTabInterval(60_000)");
    expect(source).toContain("refetchIntervalInBackground: false");
    expect(source).not.toContain("refetchInterval: 30000");
  });

  it("does not poll historical daily scans and updates scan cache locally", () => {
    const source = read("client/src/pages/factory/DailyScan.tsx");
    expect(source).toContain("isToday ? visibleTabInterval(90_000) : false");
    expect(source).toContain("setQueryData<DailyScanRow[]>");
    expect(source).not.toContain("refetchInterval: 10000");
  });

  it("reduces ground-scan background traffic and keeps invalidation active-only", () => {
    const source = read("client/src/pages/factory/GroundScan.tsx");
    expect(source).toContain("visibleTabInterval(30_000)");
    expect(source).toContain('refetchType: "active"');
    expect(source).not.toContain("refetchInterval: 4000");
  });

  it("uses summary proformas and tab-aware dispatch polling", () => {
    const source = read("client/src/pages/factory/FactoryDispatchBatches.tsx");
    expect(source).toContain("profile=summary&pageSize=250");
    expect(source).toContain('activeTab === "reports" ? visibleTabInterval(60_000) : false');
    expect(source).not.toContain("customerId=${form.customerId}`, form.customerId]");
  });

  it("loads the compact stock identity catalog only while adding a proforma item", () => {
    const source = read("client/src/pages/factory/FactoryProformas.tsx");
    expect(source).toContain("/api/stock-items/light?profile=identity");
    expect(source).toContain("enabled: isAddLineOpen && !!selectedCompany?.id");
  });
});
