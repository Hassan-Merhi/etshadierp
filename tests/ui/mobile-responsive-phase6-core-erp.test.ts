import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Mobile responsiveness Phase 6 core ERP", () => {
  it("provides reusable core ERP page, filter, summary, and action layouts", () => {
    const core = source("client/src/components/ui/core-erp-mobile.tsx");

    for (const token of [
      "CoreErpPage",
      "CoreErpHeader",
      "CoreErpHeaderActions",
      "CoreErpFilterGrid",
      "CoreErpSummaryGrid",
      "CoreErpSummaryItem",
      "CoreErpSummaryLabel",
      "CoreErpSummaryValue",
      'data-core-erp-page="true"',
      'data-core-erp-filters="true"',
      'data-core-erp-summary="true"',
      "min-[360px]:grid-cols-2",
      "min-[420px]:grid-cols-2",
    ]) {
      expect(core).toContain(token);
    }
  });

  it("keeps core ERP tabs and period filters usable on phones", () => {
    const tabs = source("client/src/components/ui/tabs.tsx");
    const periodFilter = source("client/src/components/ui/period-filter.tsx");

    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('data-responsive-tabs="true"');
    expect(tabs).toContain("overflow-x-auto overscroll-x-contain touch-pan-x");
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain("aria-selected={active}");
    expect(tabs).toContain("min-h-11");

    expect(periodFilter).toContain("useIsMobile");
    expect(periodFilter).toContain("numberOfMonths={isMobile ? 1 : 2}");
    expect(periodFilter).toContain("DialogBody");
    expect(periodFilter).toContain("w-full min-w-0 justify-between");
    expect(periodFilter).toContain("max-w-[calc(100vw-1rem)]");
  });

  it("converts Daybook filters without changing filter behavior", () => {
    const filters = source("client/src/pages/daybook/DaybookFilters.tsx");

    expect(filters).toContain("CoreErpFilterGrid");
    expect(filters).toContain('label="Daybook filters"');
    expect(filters).toContain('data-testid="select-voucher-type"');
    expect(filters).toContain('data-testid="select-status-filter"');
    expect(filters).toContain('data-testid="input-search"');
    expect(filters).toContain("overflow-x-auto overscroll-x-contain");
    expect(filters).toContain("setFilters({ ...filters, voucherType: value })");
  });

  it("converts stock item history to shared mobile list and summary contracts", () => {
    const history = source("client/src/pages/StockItemHistory.tsx");

    for (const token of [
      "CoreErpPage",
      "CoreErpHeaderActions",
      "CoreErpSummaryGrid",
      "ResponsiveDataList",
      "ResponsiveDataListField",
      'role={hasData ? "button" : undefined}',
      'event.key !== "Enter"',
      'event.key !== " "',
      'minimumWidth="52rem"',
      'scrollLabel="Stock item monthly summary"',
    ]) {
      expect(history).toContain(token);
    }

    expect(history).toContain("/api/stock-items/${stockItemId}/monthly-summary");
    expect(history).toContain("navigate(`/stock-items/${stockItemId}/history/${selectedYear}/${month}`)");
  });

  it("keeps responsive shared primitives free from ERP business mutations", () => {
    const sharedSources = [
      "client/src/components/ui/core-erp-mobile.tsx",
      "client/src/components/ui/tabs.tsx",
      "client/src/components/ui/period-filter.tsx",
    ].map(source);

    for (const contents of sharedSources) {
      for (const forbidden of [
        "useMutation(",
        "queryClient",
        "adjustInventory",
        "costPerKg",
        "ledgerAccount",
        'fetch("/api/',
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });
});
